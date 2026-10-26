const api = (method) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

async function call(method, body) {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

async function sendTelegram(chatId, html) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  await call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true });
}

// Long-polls for "bot added to / removed from a chat" so the dashboard can list target chats.
async function startPolling(db) {
  let offset = 0;
  for (;;) {
    try {
      const updates = await call("getUpdates", { offset, timeout: 50, allowed_updates: ["my_chat_member"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        const m = u.my_chat_member;
        if (!m) continue;
        const chatId = String(m.chat.id);
        if (["member", "administrator"].includes(m.new_chat_member.status)) {
          await db.upsertTelegramChat(chatId, m.chat.title || m.chat.username || chatId);
        } else {
          await db.removeTelegramChat(chatId);
        }
      }
    } catch (err) {
      // 409 during a Render deploy overlap (two instances polling) is expected and clears itself.
      console.error("Telegram polling error:", err.message);
      await new Promise((r) => setTimeout(r, 10e3));
    }
  }
}

module.exports = { sendTelegram, startPolling };
