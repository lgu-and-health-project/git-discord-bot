const test = require("node:test");
const assert = require("node:assert/strict");
const { notify, toTelegramHtml } = require("../notify");

const embed = { title: "❌ <CI> failed", description: "a & b", url: "https://x/1", color: 1 };

function fakeDiscord(fail = false) {
  const sent = [];
  return {
    sent,
    channels: {
      fetch: async () => {
        if (fail) throw new Error("no channel");
        return { send: async (m) => sent.push(m) };
      },
    },
  };
}

test("toTelegramHtml escapes and formats", () => {
  assert.equal(toTelegramHtml(embed), "<b>❌ &lt;CI&gt; failed</b>\na &amp; b\nhttps://x/1");
  assert.equal(toTelegramHtml("@here 💸 <paid>"), "💸 &lt;paid&gt;");
});

test("telegram-only target never touches discord", async () => {
  const tg = [];
  const discord = { channels: { fetch: () => assert.fail("discord used") } };
  await notify(discord, { telegram_chat_id: "-100" }, embed, async (id, t) => tg.push([id, t]));
  assert.deepEqual(tg, [["-100", toTelegramHtml(embed)]]);
});

test("discord failure still sends telegram", async () => {
  const tg = [];
  await notify(fakeDiscord(true), { channel_id: "c", telegram_chat_id: "-1" }, embed, async (id, t) => tg.push(id));
  assert.deepEqual(tg, ["-1"]);
});

test("embeds and text go to discord in the right shape", async () => {
  const d = fakeDiscord();
  await notify(d, { channel_id: "c" }, embed, async () => assert.fail("telegram used"));
  await notify(d, { channel_id: "c" }, "hello", async () => {});
  assert.deepEqual(d.sent, [{ embeds: [embed] }, "hello"]);
});
