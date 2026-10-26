const { sendTelegram } = require("./telegram");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Telegram has no @here, so the Discord mention is dropped.
function toTelegramHtml(message) {
  if (typeof message === "string") return esc(message.replace(/^@here\s*/, ""));
  return [`<b>${esc(message.title)}</b>`, message.description && esc(message.description), message.url]
    .filter(Boolean)
    .join("\n");
}

// message is an embed-shaped object or plain text. One side failing never blocks the other.
async function notify(discord, target, message, send = sendTelegram) {
  if (target.channel_id) {
    try {
      const channel = await discord.channels.fetch(target.channel_id);
      await channel.send(typeof message === "string" ? message : { embeds: [message] });
    } catch (err) {
      console.error(`Discord alert to ${target.channel_id} failed:`, err.message);
    }
  }
  if (target.telegram_chat_id) {
    try {
      await send(target.telegram_chat_id, toTelegramHtml(message));
    } catch (err) {
      console.error(`Telegram alert to ${target.telegram_chat_id} failed:`, err.message);
    }
  }
}

module.exports = { notify, toTelegramHtml };
