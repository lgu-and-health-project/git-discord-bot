# Discord ↔ GitHub Issue Bot

Syncs GitHub org issues with Discord threads, two-way:

- **New GitHub issue** → creates a Discord thread.
- **Discord thread reply** → posted as a GitHub comment, attributed to the linked GitHub account (or the Discord tag if unlinked).
- **GitHub comment / close** → relayed back into the matching Discord thread.
- **`/issue create` in Discord** → opens a GitHub issue *and* a thread, in whichever repo you pick.
- **`/issue close`** → closes the issue, from inside its thread or by naming `repo` + `number`.
- **`/issue view`** → shows an issue's status/description without leaving Discord.
- **`/repos`** → lists every repo in the org, so people aren't guessing which one to file into.
- **`/alerts`** (Manage Server) → routes workflow failures, chosen successes, releases and Brevo/AWS usage warnings to channels.
- **`/status`** → Brevo credits and this month's AWS Rekognition cost.
- **`/link` / `/unlink`** → binds a Discord account to a GitHub username so replies/created issues show up as that person on GitHub.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` — from the [Discord Developer Portal](https://discord.com/developers/applications). Enable the **Message Content** privileged intent.
   - `DISCORD_GUILD_ID` — optional, speeds up command deploys while developing.
   - `DISCORD_ISSUE_CHANNEL_ID` — channel where new-issue threads land.
   - `GITHUB_TOKEN` — a PAT with `repo` scope on the org.
   - `GITHUB_ORG` — your GitHub org name.
   - `GITHUB_BOT_USERNAME` — the username the PAT belongs to (prevents the comment-relay from echoing its own comments back into Discord).
   - `GITHUB_WEBHOOK_SECRET` — set the same value on the GitHub webhook config.
3. Register slash commands: `npm run deploy-commands`
4. Start the bot: `npm start`
5. In your GitHub org settings, add a webhook pointing at `https://your-host/github/webhook`, content type `application/json`, subscribed to the **Issues**, **Issue comments**, **Workflow runs** and **Releases** events, with the secret matching `GITHUB_WEBHOOK_SECRET`.

## How the pieces fit together

| File | Responsibility |
|---|---|
| `index.js` | Boots Express + the Discord client, wires interaction handling |
| `db.js` | Postgres (Neon): Discord↔GitHub account links, thread↔issue mapping |
| `github.js` | All GitHub API calls (Octokit) |
| `commands/*.js` | One file per slash command |
| `alerts.js` | Decides which workflow/release events become alerts (pure, tested) |
| `notify.js` / `telegram.js` | Sends alerts to Discord and/or Telegram; records Telegram chats the bot is added to |
| `dashboard/` | Vercel dashboard: static page + `api/` functions, password-protected |
| `usage.js` | Brevo + AWS Rekognition usage checks and de-duplicated alerts |
| `events/messageCreate.js` | Relays thread replies to GitHub as comments |
| `routes/githubWebhook.js` | Verifies + handles incoming GitHub webhook events |

## Hosting (Neon + Render + Vercel)

1. **Neon:** create a project and copy the connection string (`postgresql://…?sslmode=require`). The bot creates its tables on first start.
2. **Render (bot):** New → Blueprint → pick this repo (it uses `render.yaml`). Fill in the secrets, including `DATABASE_URL`. Once it's live, run `npm run deploy-commands` once from your machine with the same `.env`, and point the GitHub org webhook at `https://<render-app>.onrender.com/github/webhook`.
   - The free plan sleeps after ~15 min without HTTP traffic, which disconnects the Discord bot. Ping `https://<render-app>.onrender.com/` every 5–10 min (e.g. UptimeRobot), or use a paid instance.
3. **Telegram (optional):** create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN` on Render. Add the bot to a group, and the group then shows up in the dashboard's Telegram dropdowns.
4. **Vercel (dashboard):** New Project → this repo → **Root Directory `dashboard`**, no framework preset. Env vars: `DATABASE_URL` (same Neon URL), `DASHBOARD_PASSWORD` (long and random; changing it logs everyone out), `DISCORD_CLIENT_ID`, `TELEGRAM_BOT_USERNAME` (without `@`). Start the bot once before opening the dashboard so the tables exist.

## Usage alerts IAM policy

The AWS keys need only read access to billing data:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["ce:GetCostAndUsage", "freetier:GetAccountPlanState"], "Resource": "*" }
  ]
}
```

## Notes / things to harden before production

- The comment-relay currently skips attachment-only messages; extend `events/messageCreate.js` if you want image links included.
- Consider rate-limiting `/issue create` per user if abuse becomes a concern.
