# Org alerts for the Discord bot — design

## Intent

The team wants Discord to be the one place to see what matters across the org's projects. Nobody should have to open GitHub Actions, the Brevo dashboard or AWS billing to know whether things are okay. The Discord server already has three alert channels: **central-server**, **tenant-server** and **hris-application**.

We reuse this existing bot (an unfinished Discord ↔ GitHub issue-sync bot) instead of starting over. It already has an org-wide GitHub webhook receiver with signature checking, a slash-command loader and a Render deployment.

## Goals (phase 1)

1. **Failed runs.** A GitHub Actions workflow run that fails posts an alert to the channel mapped to its repo.
2. **New version live, mobile.** HRIS is one Expo repo, `lgu-and-health-project/HRISApplication`, with OTA updates (there are no separate Android and iOS repos). A successful run of any workflow named in that repo's `success_workflows` (its Android, iOS and OTA release workflows) posts a "released" message.
3. **New version live, servers.** A GitHub Release on `lgu-and-health-project/LGUProject-admin` posts an announcement that follows tenant-api's own channel rules (`fetchReleaseHistory`, `apps/tenant-api/src/trpc/routers/settings.router.ts:272-276`):
   - A **pre-release, or a tag containing `-beta`**, is a **beta-channel** announcement only ("available to beta boxes"). Production boxes never see these, so the message must not suggest that production orgs can update.
   - A **stable release** is labeled **automatic** if it "moves patch" (`movesPatch`: production boxes pull it through Watchtower's `:patch` tag) or **manual** if not (a feature release someone installs by hand). The builder copies the `movesPatch` rule exactly from `settings.router.ts` in the LGUProject-admin repo (cloned on this machine under `C:\dev`) and adds a comment pointing to the source, since the two have to stay in step.
4. **External service usage.**
   - Brevo: remaining email credits. The user described this as "300 free per month". Brevo's free plan is normally 300/day, so the bot reports whatever Brevo's API says and doesn't hardcode 300.
   - AWS Rekognition: remaining free credits and the month-to-date Rekognition cost, with a loud alert the first time real money is charged after the credits run out.
5. **Customizable from Discord.** Which repo goes to which channel, which alert types are on, which workflows count as releases, the usage channel and thresholds are all changed with `/alerts`, with no code change or redeploy.
6. **`/status`** shows the current Brevo and AWS numbers on demand.

## Phase 2 (not now, but don't block it)

- **Contabo VPS stats** (CPU, RAM, disk, reachability). There is one VPS today, and the count will grow. Contabo's API only gives power state, so this will be a small script on each VPS that POSTs stats to the bot and is shown in `/status`, plus a "VPS stopped reporting" alert. Phase 1 only has to keep this easy: the HTTP server and the settings table already allow it.

## Non-goals

- Other external services. The user confirmed Brevo and AWS Rekognition are the only ones worth tracking.
- Web dashboards, charts and historical graphs.
- Changing the existing issue-sync behaviour. It stays and keeps working.
- Migrating data from the old `data.sqlite` (my call: the bot was unfinished, so there is nothing worth carrying over).

## Anti-goals

- **Alert spam.** A usage warning posts once when it becomes true, not on every check. It can post again only after it has cleared and become true again.
- **Silent misses.** If a usage check fails (bad key, API down), say so in `/status` and log it. Never show it as "fine".
- **Settings that reset.** Settings must survive Render redeploys. That is why we use Postgres.

## Constraints and decisions made with the user

- **Hosting: Render free tier.** The user keeps it awake with their own keep-alive pings (`GET /` already exists). The disk is ephemeral, so nothing may rely on local files.
- **Database: Neon Postgres** (user's decision), using `DATABASE_URL`. **All** storage moves there, including the existing `threads` and `users` tables, and `better-sqlite3` is removed. The user chose this so there is no second migration later.
- **One org.** Every repo that sends alerts (LGUProject-admin, HRISApplication, and others such as OneHealth) is in `lgu-and-health-project`, so the one org webhook and repo names without the org are enough (`GITHUB_ORG=lgu-and-health-project`).
- Stack stays as it is: Node, CommonJS, discord.js 14, Express, Octokit. One file per slash command in `commands/`.

## How it works

### Storage (`db.js`, rewritten on `pg`)

Same exported function names as today, but they become `async`. Every caller must `await` them: `commands/link.js`, `commands/unlink.js`, `commands/issue.js`, `events/messageCreate.js` and `routes/githubWebhook.js`. Tables are created with `CREATE TABLE IF NOT EXISTS` on startup.

- `threads`, `users`: same columns as now.
- `repo_alerts`: `repo TEXT PRIMARY KEY` (repo name without the org), `channel_id TEXT`, `failures BOOLEAN DEFAULT true`, `releases BOOLEAN DEFAULT false`, `success_workflows TEXT[] DEFAULT '{}'`.
- `settings`: `key TEXT PRIMARY KEY`, `value JSONB`. Holds `usage` (channel id, `brevoWarnBelowCredits` default 60, `awsWarnCreditsBelowUsd` default 10, `checkEveryHours` default 6) and the usage-alert state used for de-duplication.

### GitHub events (`routes/githubWebhook.js`)

Add to the existing handler. Repos with no `repo_alerts` row are ignored.

| Event | Condition | Message |
|---|---|---|
| `workflow_run` / `completed` | `conclusion` is `failure`, `timed_out` or `startup_failure`, and `failures` is on | ❌ repo, workflow name, branch, triggering user, link to the run |
| `workflow_run` / `completed` | `conclusion` is `success` and the workflow name is in `success_workflows` | ✅ "<workflow> succeeded" with the branch/tag and a link |
| `release` / `released` | `releases` is on, and the tag has no `-beta` | 🆕 "<tag> available to production orgs" + **automatic** / **manual** label, name, trimmed notes, link |
| `release` / `released` with a `-beta` tag, or `release` / `prereleased` | `releases` is on | 🧪 "<tag> available on the beta channel", name, link |

Using `released`/`prereleased` rather than `published` means each release posts once, and promoting a pre-release to stable also gets announced (GitHub sends `released` for that).

Use Discord embeds (red/green/blue). Keep the decision "event → message or nothing" in a pure function so it can be tested without Discord.

**Setup change:** the org webhook must also subscribe to **Workflow runs** and **Releases** events (README update).

### Usage checks (new `usage.js`)

- Runs on startup, then every `checkEveryHours`, using `setInterval` in the same process. A Cost Explorer request costs about $0.01, so don't poll faster.
- **Brevo:** `GET https://api.brevo.com/v3/account` with the `api-key` header. Read the credits from the `plan` entries.
- **AWS:** Cost Explorer `GetCostAndUsage` for the month to date, filtered to the Rekognition service, for both gross and net cost (net is what's charged after credits). Remaining credits come from the Free Tier API (`GetAccountPlanState` on the newer credit-based free plan). **The builder must verify** which API exposes the remaining credit for this account. If none does, show net vs. gross and say that the credit balance isn't available.
- Alerts (de-duplicated through `settings`): Brevo below the **absolute** credit threshold (Brevo's API gives credits left, not the plan size). It posts **at most once per reset period**: the free plan resets daily, so the de-dup key includes the date (UTC day; my call). If Brevo reports a monthly plan, use the month instead. Also: AWS credits below the $ threshold, and AWS net Rekognition cost going above $0 this month (the "now paying" alert, posted with an @here mention).
- New env vars: `BREVO_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (Cost Explorer uses `us-east-1`), `DATABASE_URL`. The IAM user needs only `ce:GetCostAndUsage` plus the free-tier read permission.

### Commands

- **`/alerts`**, restricted to members with Manage Server (`setDefaultMemberPermissions`). Subcommands:
  - `route repo channel` sets the repo → channel mapping (repo autocomplete from the existing `github.listOrgRepos`)
  - `toggle repo type(failures|releases) on|off`
  - `workflows repo names` sets the comma-separated success workflow names
  - `usage channel [brevo_credits] [aws_credit_usd] [hours]`
  - `list` shows the current configuration
- **`/status`** runs the Brevo and AWS checks live and shows the numbers plus any error. It is ephemeral.

### Tests

The repo has none. Add `node:test` tests (`npm test`) for the pure webhook decision function and the usage threshold/de-dup logic. No new test dependency.

## Left to the builder

- Exact embed wording and layout.
- Whether `/alerts` is one command with subcommands (preferred) or several.
- How to handle a usage interval change made through `/alerts usage` (restarting the timer, or reading the setting each tick, are both fine).
