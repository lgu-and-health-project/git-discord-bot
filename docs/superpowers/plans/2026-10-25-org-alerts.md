# Org Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub failure/release alerts, Brevo and AWS Rekognition usage alerts, and `/alerts` + `/status` commands to the existing Discord bot, with all storage moved to Neon Postgres.

**Architecture:** The pure decision logic goes in two new modules: `alerts.js` (GitHub event → embed or null) and `usage.js` (snapshot → alerts plus de-dup state). They are unit-tested with `node:test`. Thin I/O wrappers call them: the existing webhook route, a `setInterval` in `index.js` and two slash commands. `db.js` keeps its shape but moves to `pg`, and every function becomes async.

**Tech Stack:** Node (CommonJS), discord.js 14, Express 4, Octokit, `pg`, `@aws-sdk/client-cost-explorer`, `@aws-sdk/client-freetier`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-25-org-alerts-design.md`

## Global Constraints

- Render free tier: no local files may hold state. `better-sqlite3` is removed and everything goes through `DATABASE_URL` (Neon, `ssl: { rejectUnauthorized: false }` is fine).
- One org: `GITHUB_ORG=lgu-and-health-project`. `repo_alerts.repo` is the repo name without the org (`repository.name`).
- Usage defaults: `brevoWarnBelowCredits` 60, `awsWarnCreditsBelowUsd` 10, `checkEveryHours` 6. Don't poll Cost Explorer more often (~$0.01 per request).
- Usage alerts post once when they become true. The Brevo warning posts at most once per UTC day.
- A failed usage check is never shown as "fine". It shows as an error in `/status` and posts no alert.
- `/alerts` uses `setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)`.
- Match house style: one file per command in `commands/`, `ephemeral: true` replies for personal/admin output, `console.error` with context on failures.
- New env vars: `DATABASE_URL`, `BREVO_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`. Only `DATABASE_URL` joins `REQUIRED_ENV`. A missing Brevo/AWS key shows as "not configured" in `/status`, not a crash.

## Review Focus

1. A webhook for a repo with no `repo_alerts` row → nothing posted (Task 2 test `ignores unrouted repo`).
2. A LGUProject-admin release without a `tenant-v` tag or without the `<!-- release-meta -->` header → skipped, like tenant-api does (Task 2 test `skips release without meta`).
3. Very long release notes → the embed description is trimmed to ≤ 4000 chars and still ends with a link (Task 2 test `trims long notes`).
4. Workflow names typed in `/alerts workflows` with different case or spaces (" android release") → still match (Task 2 test `matches workflow names loosely`).
5. Brevo or AWS check throws → no alert, and the de-dup state for that service is left as is, so a flaky API doesn't re-post the warning when it recovers (Task 3 test `error keeps state`).

---

### Task 1: Move `db.js` to Postgres

**Files:**
- Modify: `db.js` (rewrite), `package.json`, `env.example`, `index.js:13` (`REQUIRED_ENV`)
- Modify callers to `await`: `commands/link.js:23`, `commands/unlink.js:10`, `commands/issue.js:78,104,120`, `events/messageCreate.js:9,14`, `routes/githubWebhook.js:70,79,98`

**Interfaces:**
- Produces (all async): the existing `linkThreadToIssue`, `getThreadByIssue`, `getIssueByThread`, `linkUser`, `unlinkUser`, `getGithubUsername`, same arguments and return shapes. Plus:
  - `init(): Promise<void>` creates the tables (`threads`, `users`, `repo_alerts`, `settings` exactly as in the spec) with `CREATE TABLE IF NOT EXISTS`
  - `getRepoAlert(repo: string): Promise<{repo, channel_id, failures, releases, success_workflows: string[]} | null>`
  - `upsertRepoAlert(repo: string, patch: Partial<{channel_id, failures, releases, success_workflows}>): Promise<void>` (insert with defaults, then apply the patch)
  - `listRepoAlerts(): Promise<Array<same row>>`
  - `getSetting(key: string): Promise<any | null>`, `setSetting(key: string, value: any): Promise<void>` (JSONB)

- [ ] **Step 1:** `npm uninstall better-sqlite3 && npm install pg`
- [ ] **Step 2:** Rewrite `db.js` with a `pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })`. `INSERT OR REPLACE` becomes `INSERT … ON CONFLICT (pk) DO UPDATE`.
- [ ] **Step 3:** Add `await` at every listed caller. In `index.js`, add `DATABASE_URL` to `REQUIRED_ENV` and `await db.init()` before `discord.login` (wrap it in an async IIFE that exits 1 on failure with "Database init failed — check DATABASE_URL").
- [ ] **Step 4:** Add `DATABASE_URL=` (with a comment) to `env.example`. Remove the `data.sqlite` note from the README.
- [ ] **Step 5: Verify:** `grep -rn "db\.\w*(" --include=*.js . | grep -v node_modules | grep -v "await\|db.js"` prints nothing. With a Neon `DATABASE_URL` in `.env`, `npm start` logs "Discord bot online", and `/link` then `/unlink` succeed.
- [ ] **Step 6: Commit** `feat: move storage to Postgres (Neon)`

### Task 2: GitHub alert decisions + webhook wiring

**Files:**
- Create: `alerts.js`, `test/alerts.test.js`
- Modify: `routes/githubWebhook.js`, `package.json` (`"test": "node --test"`)

**Interfaces:**
- Consumes: `db.getRepoAlert` (Task 1)
- Produces:
  - `parseReleaseMeta(tagName: string, body: string): {version, movesPatch: boolean, hasMigrations: boolean, notes: string} | null`. Same rule as tenant-api `settings.router.ts:45-60`: the tag must start with `tenant-v`, the body must match `/<!-- release-meta: (\{.*?\}) -->/`, the JSON must parse, and `notes` is everything after the header, trimmed. Put a comment above it pointing to that file.
  - `decideGithubAlert(event: string, payload: object, route: RepoAlertRow | null): EmbedBuilder-compatible plain object {title, description, url, color} | null`

Rules (from the spec):
| input | output |
|---|---|
| route null | null |
| `workflow_run`, `completed`, conclusion ∈ {failure, timed_out, startup_failure}, `route.failures` | red `0xE74C3C`, title `❌ <workflow> failed — <repo>`, description includes branch `head_branch` and `triggering_actor.login`, url `html_url` |
| `workflow_run`, `completed`, `success`, name in `success_workflows` (trimmed, case-insensitive) | green `0x2ECC71`, title `✅ <workflow> succeeded — <repo>`, includes branch |
| `release`, `released`, tag without `-beta`, `route.releases`, meta parses | blue `0x3498DB`, title `🆕 <version> available to production orgs`, description starts with `**Automatic** (patch channel)` if movesPatch, else `**Manual install**`. Adds `⚠️ Includes DB migrations` if hasMigrations, then the notes |
| `release`, `prereleased`, or `released` with `-beta` in the tag, `route.releases`, meta parses | yellow `0xF1C40F`, title `🧪 <version> available on the beta channel` |
| anything else | null |

Description is capped at 4000 chars: cut the notes and end with `…\n<release html_url>`.

- [ ] **Step 1: Write failing tests** in `test/alerts.test.js` (`node:test` + `node:assert/strict`), one per row above plus the Review Focus cases: `ignores unrouted repo`, `skips release without meta` (tag `v1.0.0`, and a `tenant-v1.0.0` tag with no header), `trims long notes` (10,000-char notes → `description.length <= 4000` and ends with the url), `matches workflow names loosely` (`success_workflows: [" Android Release "]`, payload name `android release` → green). Also check that a successful workflow not in the list → null, and that `failures: false` → null for a failure.
- [ ] **Step 2:** `npm test`, expect FAIL (`Cannot find module '../alerts'`).
- [ ] **Step 3:** Implement `alerts.js`.
- [ ] **Step 4:** `npm test`, all PASS.
- [ ] **Step 5:** In `routes/githubWebhook.js`, inside the existing try block, for `workflow_run` and `release` events: `const route = await db.getRepoAlert(repository.name)`, `const embed = decideGithubAlert(event, req.body, route)`, and if there's an embed, fetch `route.channel_id` and `send({ embeds: [embed] })`. The existing issue branches stay untouched.
- [ ] **Step 6:** README setup step 5: subscribe the org webhook to **Workflow runs** and **Releases** too.
- [ ] **Step 7: Commit** `feat: post workflow and release alerts`

### Task 3: Usage checks (Brevo + AWS)

**Files:**
- Create: `usage.js`, `test/usage.test.js`
- Modify: `index.js` (scheduler), `package.json`, `env.example`

**Interfaces:**
- Consumes: `db.getSetting/setSetting` (Task 1)
- Produces:
  - `DEFAULT_USAGE = { channel_id: null, brevoWarnBelowCredits: 60, awsWarnCreditsBelowUsd: 10, checkEveryHours: 6 }`
  - `fetchBrevo(): Promise<{credits: number, creditsType: string, planType: string}>`: `GET https://api.brevo.com/v3/account`, header `api-key`. Uses the `plan` entry for email (`creditsType` `sendLimit`, or the first entry with `credits`). Throws if `BREVO_API_KEY` is unset (`"not configured"`).
  - `fetchAws(): Promise<{grossUsd: number, netUsd: number, creditsLeftUsd: number | null}>`: Cost Explorer (`region: "us-east-1"`) `GetCostAndUsage`, month start to tomorrow, `Granularity: MONTHLY`, filter `SERVICE = "Amazon Rekognition"`, metrics `UnblendedCost` (gross) and `NetUnblendedCost` (net). Credits: try `@aws-sdk/client-freetier` `GetAccountPlanStateCommand` (`accountPlanRemainingCredits.amount`). If that call or field isn't available, `creditsLeftUsd: null`. **Verify the command and field names against the installed SDK's types before relying on them.**
  - `checkUsage(snapshot: {brevo?: object, brevoError?: string, aws?: object, awsError?: string}, settings: DEFAULT_USAGE shape, state: object, now: Date): {alerts: string[], state: object}`: pure.
    - Brevo low: `credits < brevoWarnBelowCredits` and `state.brevoLowDay !== <UTC YYYY-MM-DD of now>` → alert, set `brevoLowDay`.
    - AWS credits low: `creditsLeftUsd !== null && < awsWarnCreditsBelowUsd && !state.awsCreditsLow` → alert, set true. Clear it when back above the threshold.
    - AWS paying: `netUsd > 0` and `state.awsPayingMonth !== <UTC YYYY-MM>` → alert starting `@here 💸`, set `awsPayingMonth`.
    - Any `*Error` → that service's checks are skipped and its state is unchanged.
  - `runUsageCheck(discord): Promise<{snapshot, alerts}>`: fetches both (catching each error into `brevoError`/`awsError`), loads `usage` + `usage_state` settings, calls `checkUsage`, saves the state, and posts the alerts to `settings.channel_id` if set. Used by the scheduler and `/status`.

- [ ] **Step 1: Write failing tests** in `test/usage.test.js`: `brevo warns once per day` (two calls on the same day → 1 alert, then the next day → alert again), `aws credits low then clears` (rearms after going back above the threshold), `aws paying once per month`, `null credits never warns`, `error keeps state` (snapshot has `brevoError` and no `brevo`, state `{brevoLowDay: "<yesterday>"}` → `alerts` is empty and the returned state deep-equals the input).
- [ ] **Step 2:** `npm test`, expect FAIL.
- [ ] **Step 3:** `npm install @aws-sdk/client-cost-explorer @aws-sdk/client-freetier`, then implement `usage.js`.
- [ ] **Step 4:** `npm test`, all PASS.
- [ ] **Step 5:** `index.js`: in `discord.once("ready")`, run `runUsageCheck` now and then on a 15-minute `setInterval`. Each tick reads `checkEveryHours` and runs only if `Date.now() - lastRun >= hours*3600e3` (this settles the spec's "interval change" choice). Errors are logged and never thrown.
- [ ] **Step 6:** Add the Brevo/AWS env vars to `env.example`. In the README, add the IAM policy (`ce:GetCostAndUsage`, `freetier:GetAccountPlanState`).
- [ ] **Step 7: Commit** `feat: Brevo and AWS Rekognition usage alerts`

### Task 4: `/alerts` and `/status` commands

**Files:**
- Create: `commands/alerts.js`, `commands/status.js`
- Modify: `commands/help.js` (mention both), `README.md` (feature list + file table)

**Interfaces:**
- Consumes: `db.upsertRepoAlert`, `db.listRepoAlerts`, `db.getSetting/setSetting` (Task 1), `DEFAULT_USAGE`, `runUsageCheck` (Task 3), `github.listOrgRepos` (repo autocomplete, the same way `commands/issue.js:60-63` does it)

`/alerts` (ManageGuild, ephemeral replies) subcommands:
- `route repo:<string, autocomplete> channel:<channel>` → `upsertRepoAlert(repo, {channel_id})`
- `toggle repo type:<choice failures|releases> enabled:<boolean>` → refuses if the repo has no route ("Run `/alerts route` first")
- `workflows repo names:<string, comma-separated>` → stored trimmed, empties dropped. An empty string clears the list.
- `usage channel:<channel> brevo_credits:<int, optional> aws_credit_usd:<number, optional> hours:<int min 1, optional>` → merged onto the stored or `DEFAULT_USAGE` value
- `list` → one line per repo (`repo → #channel · failures on/off · releases on/off · workflows: …`) plus the usage line

`/status` (ephemeral, deferred): calls `runUsageCheck(interaction.client)` and replies with Brevo `credits` (`planType`), AWS `gross/net` this month, and credits left (or "credit balance unavailable"). A failed service shows `⚠️ <error>`. Note: this also posts any newly due alerts to the usage channel, which is intended.

- [ ] **Step 1:** Implement both commands. Run `npm run deploy-commands` → "Successfully reloaded".
- [ ] **Step 2: Verify in Discord:**
  - `/alerts route repo:HRISApplication channel:#hris-application`, then `/alerts list` shows it.
  - Redeliver a `workflow_run` event from GitHub's webhook "Recent Deliveries" → the embed appears.
  - `/status` shows real numbers, or a clear error.
  - A member without Manage Server can't see `/alerts`.
- [ ] **Step 3:** `npm test` still passes.
- [ ] **Step 4: Commit** `feat: /alerts and /status commands`
