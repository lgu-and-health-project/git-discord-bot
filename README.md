# Discord ↔ GitHub Issue Bot

Syncs GitHub org issues with Discord threads, two-way:

- **New GitHub issue** → creates a Discord thread.
- **Discord thread reply** → posted as a GitHub comment, attributed to the linked GitHub account (or the Discord tag if unlinked).
- **GitHub comment / close** → relayed back into the matching Discord thread.
- **`/issue create` in Discord** → opens a GitHub issue *and* a thread, in whichever repo you pick.
- **`/issue close`** → closes the issue, from inside its thread or by naming `repo` + `number`.
- **`/issue view`** → shows an issue's status/description without leaving Discord.
- **`/repos`** → lists every repo in the org, so people aren't guessing which one to file into.
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
5. In your GitHub org settings, add a webhook pointing at `https://your-host/github/webhook`, content type `application/json`, subscribed to the **Issues** and **Issue comments** events, with the secret matching `GITHUB_WEBHOOK_SECRET`.

## How the pieces fit together

| File | Responsibility |
|---|---|
| `index.js` | Boots Express + the Discord client, wires interaction handling |
| `db.js` | SQLite: Discord↔GitHub account links, thread↔issue mapping |
| `github.js` | All GitHub API calls (Octokit) |
| `commands/*.js` | One file per slash command |
| `events/messageCreate.js` | Relays thread replies to GitHub as comments |
| `routes/githubWebhook.js` | Verifies + handles incoming GitHub webhook events |

## Notes / things to harden before production

- `data.sqlite` is created next to `db.js` — back it up or point it at a persistent volume.
- The comment-relay currently skips attachment-only messages; extend `events/messageCreate.js` if you want image links included.
- Consider rate-limiting `/issue create` per user if abuse becomes a concern.
