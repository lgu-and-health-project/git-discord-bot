# Addendum: Dashboard + Telegram alerts (2026-10-26)

Extends `2026-10-25-org-alerts-design.md`. Deliverables: bot on Render, Neon database, a minimal dashboard on Vercel, Discord bot + Telegram alerts.

## Decisions (from the user, 2026-10-26)

- **Telegram is alerts only.** Workflow, release and usage alerts can go to a Telegram chat, a Discord channel, or both. Issues and thread relay stay Discord-only.
- **Both `/alerts` and the dashboard** edit the same Neon tables.
- **The dashboard is private (team only).** It shows the Discord invite link and the Telegram "add to group" link, each with a QR code, so the bots can be added instantly.
- Ruling: the dashboard is protected by one `DASHBOARD_PASSWORD`. It can change where alerts go, so it can't be left open even if nobody publishes the URL. The bot tokens are never shown, because a leaked token gives full control of the bot.

## Storage changes

- `repo_alerts` gains `telegram_chat_id TEXT`.
- `usage` setting gains `telegram_chat_id`.
- New table `telegram_chats`: `chat_id TEXT PRIMARY KEY`, `title TEXT`, `added_at TIMESTAMPTZ DEFAULT now()`. The bot records every chat it is added to, so the dashboard can offer them as targets.

## Telegram (bot, `telegram.js`)

- Env: `TELEGRAM_BOT_TOKEN` (optional; if unset, Telegram is off and nothing crashes).
- Long-polls `getUpdates` in the bot process (no webhook setup). A `my_chat_member` update where the bot becomes a member/admin → upsert into `telegram_chats`; removed → delete.
- `sendTelegram(chatId, text)` → `sendMessage` with `parse_mode: HTML`.
- One delivery helper, `notify(discord, target, embed)` where `target = {channel_id, telegram_chat_id}`: Discord gets the embed, Telegram gets `<b>title</b>\ndescription\nurl` (HTML-escaped). A failure on one side is logged and doesn't block the other.

## Dashboard (`dashboard/`, Vercel project root = `dashboard`)

- Static `index.html` + Vercel Node functions in `dashboard/api/`, using `pg` against the same `DATABASE_URL`.
- Env on Vercel: `DATABASE_URL`, `DASHBOARD_PASSWORD`, `DISCORD_CLIENT_ID`, `TELEGRAM_BOT_USERNAME`.
- Login: POST the password → an HttpOnly, Secure, SameSite=Strict cookie holding an HMAC (keyed by `DASHBOARD_PASSWORD`). Every API call checks it, using a constant-time compare.
- Page sections:
  1. **Add the bot:** a Discord invite URL (`scope=bot applications.commands`, the permissions the bot needs) and `https://t.me/<TELEGRAM_BOT_USERNAME>?startgroup=true`, each with a QR code.
  2. **Repo alerts:** a table of `repo_alerts`. Edit the Discord channel id, the Telegram chat (dropdown from `telegram_chats`), the failures/releases toggles and the success workflows. Add a repo or remove one.
  3. **Usage alerts:** the thresholds, the hours, the Discord channel and the Telegram chat.
- Live usage numbers stay in `/status` in Discord (the dashboard doesn't call AWS/Brevo).
