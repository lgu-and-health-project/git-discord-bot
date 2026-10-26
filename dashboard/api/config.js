const { db, requireAuth } = require("./_lib");

// shortcut: duplicated from the bot's usage.js DEFAULT_USAGE (Vercel deploys only dashboard/), keep in sync.
const DEFAULT_USAGE = { channel_id: null, telegram_chat_id: null, brevoWarnBelowCredits: 60, awsWarnCreditsBelowUsd: 10, checkEveryHours: 6 };
// View Channels, Send Messages, Embed Links, Read History, Mention @here, Add Reactions, threads (create/send/manage).
const DISCORD_PERMISSIONS = "326417730624";

const isRepo = (v) => typeof v === "string" && /^[\w.-]{1,100}$/.test(v);
const isChannel = (v) => v === null || (typeof v === "string" && /^\d{17,20}$/.test(v));
const isTgChat = (v) => v === null || (typeof v === "string" && /^-?\d{1,20}$/.test(v));
const isNum = (v, min) => typeof v === "number" && Number.isFinite(v) && v >= min;

function cleanRepoPatch(p = {}) {
  const out = {};
  if ("channel_id" in p) { if (!isChannel(p.channel_id)) throw "invalid Discord channel id"; out.channel_id = p.channel_id; }
  if ("telegram_chat_id" in p) { if (!isTgChat(p.telegram_chat_id)) throw "invalid Telegram chat id"; out.telegram_chat_id = p.telegram_chat_id; }
  for (const k of ["failures", "releases"]) {
    if (k in p) { if (typeof p[k] !== "boolean") throw `${k} must be true/false`; out[k] = p[k]; }
  }
  if ("success_workflows" in p) {
    const w = p.success_workflows;
    if (!Array.isArray(w) || w.length > 50 || !w.every((n) => typeof n === "string" && n.length <= 100)) throw "invalid workflow list";
    out.success_workflows = w.map((n) => n.trim()).filter(Boolean);
  }
  return out;
}

function cleanUsage(u = {}) {
  if (!isChannel(u.channel_id ?? null) || !isTgChat(u.telegram_chat_id ?? null)) throw "invalid channel or chat id";
  if (!isNum(u.brevoWarnBelowCredits, 0) || !isNum(u.awsWarnCreditsBelowUsd, 0) || !Number.isInteger(u.checkEveryHours) || u.checkEveryHours < 1)
    throw "invalid thresholds";
  return {
    channel_id: u.channel_id ?? null,
    telegram_chat_id: u.telegram_chat_id ?? null,
    brevoWarnBelowCredits: u.brevoWarnBelowCredits,
    awsWarnCreditsBelowUsd: u.awsWarnCreditsBelowUsd,
    checkEveryHours: u.checkEveryHours,
  };
}

async function load() {
  const q = (sql) => db().query(sql).then((r) => r.rows);
  const [repoAlerts, telegramChats, usageRows] = await Promise.all([
    q("SELECT * FROM repo_alerts ORDER BY repo"),
    q("SELECT chat_id, title FROM telegram_chats ORDER BY title"),
    q("SELECT value FROM settings WHERE key = 'usage'"),
  ]);
  const tg = process.env.TELEGRAM_BOT_USERNAME;
  return {
    repoAlerts,
    telegramChats,
    usage: { ...DEFAULT_USAGE, ...usageRows[0]?.value },
    links: {
      discord: process.env.DISCORD_CLIENT_ID
        ? `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&scope=bot+applications.commands&permissions=${DISCORD_PERMISSIONS}`
        : null,
      telegram: tg ? `https://t.me/${tg}?startgroup=true` : null,
    },
  };
}

async function save(body) {
  const { action, repo } = body || {};
  if (action === "saveRepo") {
    if (!isRepo(repo)) throw "invalid repo name";
    const patch = cleanRepoPatch(body.patch);
    await db().query("INSERT INTO repo_alerts (repo) VALUES ($1) ON CONFLICT (repo) DO NOTHING", [repo]);
    const cols = Object.keys(patch); // validated keys only
    if (cols.length)
      await db().query(`UPDATE repo_alerts SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE repo = $1`, [repo, ...cols.map((c) => patch[c])]);
  } else if (action === "deleteRepo") {
    if (!isRepo(repo)) throw "invalid repo name";
    await db().query("DELETE FROM repo_alerts WHERE repo = $1", [repo]);
  } else if (action === "saveUsage") {
    const usage = cleanUsage(body.usage);
    await db().query(
      "INSERT INTO settings (key, value) VALUES ('usage', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(usage)]
    );
  } else {
    throw "unknown action";
  }
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === "POST") {
      try {
        await save(req.body);
      } catch (err) {
        if (typeof err === "string") return res.status(400).json({ error: err });
        throw err;
      }
    } else if (req.method !== "GET") {
      return res.status(405).end();
    }
    res.json(await load());
  } catch (err) {
    console.error("dashboard config error:", err);
    res.status(500).json({ error: "database error — has the bot started once to create the tables?" });
  }
};

module.exports.cleanRepoPatch = cleanRepoPatch;
module.exports.cleanUsage = cleanUsage;
