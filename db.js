const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
// Neon closes idle connections; without this listener the error would crash the process.
pool.on('error', (err) => console.error('Postgres idle client error:', err.message));

async function one(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

module.exports = {
  pool,
  async init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        repo TEXT,
        issue_number INTEGER,
        creator_id TEXT
      );
      CREATE TABLE IF NOT EXISTS users (
        discord_id TEXT PRIMARY KEY,
        github_username TEXT
      );
      CREATE TABLE IF NOT EXISTS repo_alerts (
        repo TEXT PRIMARY KEY,
        channel_id TEXT,
        failures BOOLEAN DEFAULT true,
        releases BOOLEAN DEFAULT false,
        success_workflows TEXT[] DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB
      );
      ALTER TABLE repo_alerts ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
      CREATE TABLE IF NOT EXISTS telegram_chats (
        chat_id TEXT PRIMARY KEY,
        title TEXT,
        added_at TIMESTAMPTZ DEFAULT now()
      );
    `);
  },
  async linkThreadToIssue(thread_id, repo, issue_number, creator_id = null) {
    await pool.query(
      `INSERT INTO threads (thread_id, repo, issue_number, creator_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (thread_id) DO UPDATE SET repo = $2, issue_number = $3, creator_id = $4`,
      [thread_id, repo, issue_number, creator_id]
    );
  },
  getThreadByIssue(repo, issue_number) {
    return one('SELECT * FROM threads WHERE repo = $1 AND issue_number = $2', [repo, issue_number]);
  },
  getIssueByThread(thread_id) {
    return one('SELECT * FROM threads WHERE thread_id = $1', [thread_id]);
  },
  async linkUser(discord_id, github_username) {
    await pool.query(
      `INSERT INTO users (discord_id, github_username) VALUES ($1, $2)
       ON CONFLICT (discord_id) DO UPDATE SET github_username = $2`,
      [discord_id, github_username]
    );
  },
  async unlinkUser(discord_id) {
    await pool.query('DELETE FROM users WHERE discord_id = $1', [discord_id]);
  },
  async getGithubUsername(discord_id) {
    const row = await one('SELECT github_username FROM users WHERE discord_id = $1', [discord_id]);
    return row ? row.github_username : null;
  },
  getRepoAlert(repo) {
    return one('SELECT * FROM repo_alerts WHERE repo = $1', [repo]);
  },
  async upsertRepoAlert(repo, patch) {
    await pool.query('INSERT INTO repo_alerts (repo) VALUES ($1) ON CONFLICT (repo) DO NOTHING', [repo]);
    // Column names come from this fixed list only, never from the caller's keys.
    const cols = ['channel_id', 'telegram_chat_id', 'failures', 'releases', 'success_workflows'].filter((c) => c in patch);
    if (!cols.length) return;
    await pool.query(
      `UPDATE repo_alerts SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE repo = $1`,
      [repo, ...cols.map((c) => patch[c])]
    );
  },
  async listRepoAlerts() {
    const { rows } = await pool.query('SELECT * FROM repo_alerts ORDER BY repo');
    return rows;
  },
  async getSetting(key) {
    const row = await one('SELECT value FROM settings WHERE key = $1', [key]);
    return row ? row.value : null;
  },
  async upsertTelegramChat(chat_id, title) {
    await pool.query(
      `INSERT INTO telegram_chats (chat_id, title) VALUES ($1, $2)
       ON CONFLICT (chat_id) DO UPDATE SET title = $2`,
      [chat_id, title]
    );
  },
  async removeTelegramChat(chat_id) {
    await pool.query('DELETE FROM telegram_chats WHERE chat_id = $1', [chat_id]);
  },
  async listTelegramChats() {
    const { rows } = await pool.query('SELECT * FROM telegram_chats ORDER BY title');
    return rows;
  },
  async setSetting(key, value) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, JSON.stringify(value)]
    );
  },
};
