const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DASHBOARD_PASSWORD = "correct horse battery staple";
const { sign, verify, checkPassword } = require("../dashboard/api/_lib");

const now = 1_800_000_000_000;

test("signed cookie verifies", () => {
  assert.equal(verify(`a=1; session=${sign(now)}`, now + 1000), true);
});

test("tampered, expired or missing cookie is rejected", () => {
  const token = sign(now);
  const [exp, mac] = token.split(".");
  assert.equal(verify(`session=${Number(exp) + 1}.${mac}`, now), false);
  assert.equal(verify(`session=${exp}.${mac.slice(0, -1)}0`, now), false);
  assert.equal(verify(`session=${token}`, now + 8 * 864e5), false);
  assert.equal(verify("", now), false);
  assert.equal(verify(undefined, now), false);
});

test("password check", () => {
  assert.equal(checkPassword("correct horse battery staple"), true);
  assert.equal(checkPassword("wrong"), false);
  assert.equal(checkPassword(undefined), false);
});

test("changing the password invalidates sessions", () => {
  const token = sign(now);
  process.env.DASHBOARD_PASSWORD = "new password";
  assert.equal(verify(`session=${token}`, now), false);
  process.env.DASHBOARD_PASSWORD = "correct horse battery staple";
});

const { cleanRepoPatch, cleanUsage } = require("../dashboard/api/config");

test("repo patch validation", () => {
  assert.deepEqual(cleanRepoPatch({ failures: false, success_workflows: [" A ", ""], evil: "x" }), {
    failures: false, success_workflows: ["A"],
  });
  assert.throws(() => cleanRepoPatch({ channel_id: "abc" }));
  assert.throws(() => cleanRepoPatch({ releases: "yes" }));
  assert.deepEqual(cleanRepoPatch({ telegram_chat_id: "-1001234" }), { telegram_chat_id: "-1001234" });
});

test("usage validation", () => {
  const ok = { channel_id: "123456789012345678", brevoWarnBelowCredits: 60, awsWarnCreditsBelowUsd: 10, checkEveryHours: 6, extra: 1 };
  assert.deepEqual(cleanUsage(ok), {
    channel_id: ok.channel_id, telegram_chat_id: null, brevoWarnBelowCredits: 60, awsWarnCreditsBelowUsd: 10, checkEveryHours: 6,
  });
  assert.throws(() => cleanUsage({ ...ok, checkEveryHours: 0 }));
  assert.throws(() => cleanUsage({ ...ok, brevoWarnBelowCredits: "60" }));
});
