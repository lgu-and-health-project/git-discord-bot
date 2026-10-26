const FAILED = ["failure", "timed_out", "startup_failure"];
const MAX_DESC = 4000;

// Same rule as tenant-api settings.router.ts:45-60 — keep the two in sync.
function parseReleaseMeta(tagName, body) {
  if (!tagName?.startsWith("tenant-v")) return null;
  const match = /<!-- release-meta: (\{.*?\}) -->/.exec(body || "");
  if (!match) return null;
  let meta;
  try {
    meta = JSON.parse(match[1]);
  } catch {
    return null;
  }
  return {
    version: meta.version || tagName.slice("tenant-v".length),
    movesPatch: Boolean(meta.movesPatch),
    hasMigrations: Boolean(meta.hasMigrations),
    notes: body.slice(match.index + match[0].length).trim(),
  };
}

function cap(text, url) {
  if (text.length <= MAX_DESC) return text;
  const tail = `…\n${url}`;
  return text.slice(0, MAX_DESC - tail.length) + tail;
}

const norm = (s) => String(s || "").trim().toLowerCase();

function decideGithubAlert(event, payload, route) {
  if (!route) return null;
  const repo = payload.repository?.name;

  if (event === "workflow_run" && payload.action === "completed") {
    const run = payload.workflow_run;
    if (FAILED.includes(run.conclusion) && route.failures) {
      return {
        title: `❌ ${run.name} failed — ${repo}`,
        description: `Branch \`${run.head_branch}\` · triggered by ${run.triggering_actor?.login || "unknown"}`,
        url: run.html_url,
        color: 0xE74C3C,
      };
    }
    if (run.conclusion === "success" && (route.success_workflows || []).map(norm).includes(norm(run.name))) {
      return {
        title: `✅ ${run.name} succeeded — ${repo}`,
        description: `Branch \`${run.head_branch}\``,
        url: run.html_url,
        color: 0x2ECC71,
      };
    }
    return null;
  }

  if (event === "release" && ["released", "prereleased"].includes(payload.action) && route.releases) {
    const rel = payload.release;
    const meta = parseReleaseMeta(rel.tag_name, rel.body);
    if (!meta) return null;
    const beta = payload.action === "prereleased" || rel.tag_name.includes("-beta");
    if (beta) {
      return {
        title: `🧪 ${meta.version} available on the beta channel`,
        description: cap([rel.name, meta.notes].filter(Boolean).join("\n\n"), rel.html_url),
        url: rel.html_url,
        color: 0xF1C40F,
      };
    }
    const lines = [meta.movesPatch ? "**Automatic** (patch channel)" : "**Manual install**"];
    if (meta.hasMigrations) lines.push("⚠️ Includes DB migrations");
    if (meta.notes) lines.push("", meta.notes);
    return {
      title: `🆕 ${meta.version} available to production orgs`,
      description: cap(lines.join("\n"), rel.html_url),
      url: rel.html_url,
      color: 0x3498DB,
    };
  }

  return null;
}

module.exports = { decideGithubAlert, parseReleaseMeta };
