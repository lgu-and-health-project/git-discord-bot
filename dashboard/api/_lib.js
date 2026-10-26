const crypto = require("crypto");
const { Pool } = require("pg");

const SESSION_MS = 7 * 864e5;
let pool;

function db() {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
  return pool;
}

// Keyed by the password, so changing DASHBOARD_PASSWORD logs everyone out.
const mac = (exp) => crypto.createHmac("sha256", process.env.DASHBOARD_PASSWORD).update(`session:${exp}`).digest("hex");

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function sign(now = Date.now()) {
  const exp = now + SESSION_MS;
  return `${exp}.${mac(exp)}`;
}

function verify(cookieHeader, now = Date.now()) {
  const token = /(?:^|;\s*)session=([^;]+)/.exec(cookieHeader || "")?.[1];
  if (!token || !process.env.DASHBOARD_PASSWORD) return false;
  const [exp, sig] = token.split(".");
  return Number(exp) > now && safeEqual(sig, mac(exp));
}

function checkPassword(input) {
  return Boolean(process.env.DASHBOARD_PASSWORD) && typeof input === "string" && safeEqual(input, process.env.DASHBOARD_PASSWORD);
}

function requireAuth(req, res) {
  if (verify(req.headers.cookie)) return true;
  res.status(401).json({ error: "login required" });
  return false;
}

module.exports = { db, sign, verify, checkPassword, requireAuth, SESSION_MS };
