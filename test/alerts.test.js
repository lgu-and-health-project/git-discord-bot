const test = require("node:test");
const assert = require("node:assert/strict");
const { decideGithubAlert, parseReleaseMeta } = require("../alerts");

const route = { repo: "api", channel_id: "c1", failures: true, releases: true, success_workflows: [] };
const meta = (m) => `<!-- release-meta: ${JSON.stringify(m)} -->\nFixed things`;

function run(conclusion, name = "CI") {
  return {
    action: "completed",
    repository: { name: "api" },
    workflow_run: {
      name, conclusion, head_branch: "main",
      triggering_actor: { login: "octo" }, html_url: "https://gh/run/1",
    },
  };
}

function rel(action, tag, body, prerelease = false) {
  return {
    action,
    repository: { name: "api" },
    release: { tag_name: tag, name: tag, body, html_url: "https://gh/rel/1", prerelease },
  };
}

test("ignores unrouted repo", () => {
  assert.equal(decideGithubAlert("workflow_run", run("failure"), null), null);
});

test("workflow failure → red", () => {
  for (const c of ["failure", "timed_out", "startup_failure"]) {
    const e = decideGithubAlert("workflow_run", run(c), route);
    assert.equal(e.color, 0xE74C3C);
    assert.equal(e.title, "❌ CI failed — api");
    assert.match(e.description, /main/);
    assert.match(e.description, /octo/);
    assert.equal(e.url, "https://gh/run/1");
  }
});

test("failures off → null", () => {
  assert.equal(decideGithubAlert("workflow_run", run("failure"), { ...route, failures: false }), null);
});

test("success not in list → null", () => {
  assert.equal(decideGithubAlert("workflow_run", run("success"), route), null);
});

test("matches workflow names loosely", () => {
  const e = decideGithubAlert("workflow_run", run("success", "android release"), {
    ...route, success_workflows: [" Android Release "],
  });
  assert.equal(e.color, 0x2ECC71);
  assert.equal(e.title, "✅ android release succeeded — api");
  assert.match(e.description, /main/);
});

test("production release → blue, automatic + migrations", () => {
  const e = decideGithubAlert("release", rel("released", "tenant-v1.2.0",
    meta({ version: "1.2.0", movesPatch: true, hasMigrations: true })), route);
  assert.equal(e.color, 0x3498DB);
  assert.equal(e.title, "🆕 1.2.0 available to production orgs");
  assert.ok(e.description.startsWith("**Automatic** (patch channel)"));
  assert.match(e.description, /⚠️ Includes DB migrations/);
  assert.match(e.description, /Fixed things/);
});

test("production release without movesPatch → manual", () => {
  const e = decideGithubAlert("release", rel("released", "tenant-v1.3.0",
    meta({ version: "1.3.0", movesPatch: false, hasMigrations: false })), route);
  assert.ok(e.description.startsWith("**Manual install**"));
  assert.doesNotMatch(e.description, /migrations/);
});

test("beta release → yellow", () => {
  const body = meta({ version: "1.4.0-beta.1" });
  for (const p of [rel("prereleased", "tenant-v1.4.0-beta.1", body), rel("released", "tenant-v1.4.0-beta.1", body)]) {
    const e = decideGithubAlert("release", p, route);
    assert.equal(e.color, 0xF1C40F);
    assert.equal(e.title, "🧪 1.4.0-beta.1 available on the beta channel");
  }
});

test("releases off → null", () => {
  assert.equal(decideGithubAlert("release", rel("released", "tenant-v1.2.0", meta({ version: "1.2.0" })),
    { ...route, releases: false }), null);
});

test("skips release without meta", () => {
  assert.equal(decideGithubAlert("release", rel("released", "v1.0.0", meta({ version: "1.0.0" })), route), null);
  assert.equal(decideGithubAlert("release", rel("released", "tenant-v1.0.0", "no header"), route), null);
  assert.equal(parseReleaseMeta("tenant-v1.0.0", "<!-- release-meta: {bad} -->"), null);
});

test("trims long notes", () => {
  const body = `<!-- release-meta: {"version":"2.0.0"} -->\n${"x".repeat(10000)}`;
  const e = decideGithubAlert("release", rel("released", "tenant-v2.0.0", body), route);
  assert.ok(e.description.length <= 4000);
  assert.ok(e.description.endsWith("…\nhttps://gh/rel/1"));
});

test("other events → null", () => {
  assert.equal(decideGithubAlert("push", {}, route), null);
  assert.equal(decideGithubAlert("release", rel("published", "tenant-v1.0.0", meta({ version: "1.0.0" })), route), null);
});
