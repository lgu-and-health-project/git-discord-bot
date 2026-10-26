const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../db");
const { handleEvent } = require("../routes/githubWebhook");

process.env.DISCORD_ISSUE_CHANNEL_ID = "default-channel";

function fakeDiscord() {
  const fetched = [];
  const thread = { id: "t1", send: async () => {}, setArchived: async () => {} };
  return {
    fetched,
    channels: {
      fetch: async (id) => {
        fetched.push(id);
        return { threads: { create: async () => thread }, ...thread };
      },
    },
  };
}

const body = (extra) => ({
  repository: { name: "api", full_name: "lgu-and-health-project/api" },
  issue: { number: 7, title: "Bug", body: "x", html_url: "u", user: { login: "octo" } },
  ...extra,
});

test("issue opens in the repo's alert channel and stores the short repo name", async (t) => {
  const linked = [];
  t.mock.method(db, "getRepoAlert", async (repo) => (repo === "api" ? { channel_id: "api-channel" } : null));
  t.mock.method(db, "linkThreadToIssue", async (...args) => linked.push(args));
  const d = fakeDiscord();
  await handleEvent(d, "issues", body({ action: "opened" }));
  assert.deepEqual(d.fetched, ["api-channel"]);
  assert.deepEqual(linked, [["t1", "api", 7, "octo"]]);
});

test("issue without a repo route falls back to DISCORD_ISSUE_CHANNEL_ID", async (t) => {
  t.mock.method(db, "getRepoAlert", async () => null);
  t.mock.method(db, "linkThreadToIssue", async () => {});
  const d = fakeDiscord();
  await handleEvent(d, "issues", body({ action: "opened" }));
  assert.deepEqual(d.fetched, ["default-channel"]);
});

test("comments and closes look threads up by the short repo name (same as /issue create)", async (t) => {
  const lookups = [];
  t.mock.method(db, "getThreadByIssue", async (repo, n) => (lookups.push([repo, n]), null));
  await handleEvent(fakeDiscord(), "issues", body({ action: "closed" }));
  await handleEvent(fakeDiscord(), "issue_comment", body({ action: "created", comment: { user: { login: "a" }, body: "hi" } }));
  assert.deepEqual(lookups, [["api", 7], ["api", 7]]);
});
