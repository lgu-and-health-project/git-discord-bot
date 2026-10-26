const test = require("node:test");
const assert = require("node:assert/strict");
const { checkUsage, DEFAULT_USAGE } = require("../usage");

const day1 = new Date("2026-10-26T10:00:00Z");
const day1Later = new Date("2026-10-26T20:00:00Z");
const day2 = new Date("2026-10-27T01:00:00Z");
const brevoLow = { brevo: { credits: 10, creditsType: "sendLimit", planType: "free" } };
const aws = (o) => ({ aws: { grossUsd: 1, netUsd: 0, creditsLeftUsd: 100, ...o } });

test("brevo warns once per day", () => {
  let r = checkUsage(brevoLow, DEFAULT_USAGE, {}, day1);
  assert.equal(r.alerts.length, 1);
  r = checkUsage(brevoLow, DEFAULT_USAGE, r.state, day1Later);
  assert.equal(r.alerts.length, 0);
  r = checkUsage(brevoLow, DEFAULT_USAGE, r.state, day2);
  assert.equal(r.alerts.length, 1);
});

test("brevo above threshold → no alert", () => {
  const r = checkUsage({ brevo: { credits: 200 } }, DEFAULT_USAGE, {}, day1);
  assert.deepEqual(r.alerts, []);
});

test("aws credits low then clears", () => {
  let r = checkUsage(aws({ creditsLeftUsd: 5 }), DEFAULT_USAGE, {}, day1);
  assert.equal(r.alerts.length, 1);
  r = checkUsage(aws({ creditsLeftUsd: 4 }), DEFAULT_USAGE, r.state, day1);
  assert.equal(r.alerts.length, 0);
  r = checkUsage(aws({ creditsLeftUsd: 50 }), DEFAULT_USAGE, r.state, day1);
  assert.equal(r.alerts.length, 0);
  assert.equal(r.state.awsCreditsLow, false);
  r = checkUsage(aws({ creditsLeftUsd: 5 }), DEFAULT_USAGE, r.state, day1);
  assert.equal(r.alerts.length, 1);
});

test("aws paying once per month", () => {
  let r = checkUsage(aws({ netUsd: 0.5 }), DEFAULT_USAGE, {}, day1);
  assert.equal(r.alerts.length, 1);
  assert.ok(r.alerts[0].startsWith("@here 💸"));
  r = checkUsage(aws({ netUsd: 0.9 }), DEFAULT_USAGE, r.state, day2);
  assert.equal(r.alerts.length, 0);
  r = checkUsage(aws({ netUsd: 0.1 }), DEFAULT_USAGE, r.state, new Date("2026-11-01T00:00:00Z"));
  assert.equal(r.alerts.length, 1);
});

test("null credits never warns", () => {
  const r = checkUsage(aws({ creditsLeftUsd: null }), DEFAULT_USAGE, {}, day1);
  assert.deepEqual(r.alerts, []);
});

test("error keeps state", () => {
  const state = { brevoLowDay: "2026-10-25", awsCreditsLow: true, awsPayingMonth: "2026-09" };
  const r = checkUsage({ brevoError: "boom", awsError: "nope" }, DEFAULT_USAGE, state, day1);
  assert.deepEqual(r.alerts, []);
  assert.deepEqual(r.state, state);
});
