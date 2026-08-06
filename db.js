const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);

db.exec(`
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
`);

module.exports = {
  linkThreadToIssue(thread_id, repo, issue_number, creator_id = null) {
    const stmt = db.prepare('INSERT OR REPLACE INTO threads (thread_id, repo, issue_number, creator_id) VALUES (?, ?, ?, ?)');
    stmt.run(thread_id, repo, issue_number, creator_id);
  },
  getThreadByIssue(repo, issue_number) {
    const stmt = db.prepare('SELECT * FROM threads WHERE repo = ? AND issue_number = ?');
    return stmt.get(repo, issue_number);
  },
  getIssueByThread(thread_id) {
    const stmt = db.prepare('SELECT * FROM threads WHERE thread_id = ?');
    return stmt.get(thread_id);
  },
  linkUser(discord_id, github_username) {
    const stmt = db.prepare('INSERT OR REPLACE INTO users (discord_id, github_username) VALUES (?, ?)');
    stmt.run(discord_id, github_username);
  },
  unlinkUser(discord_id) {
    const stmt = db.prepare('DELETE FROM users WHERE discord_id = ?');
    stmt.run(discord_id);
  },
  getGithubUsername(discord_id) {
    const stmt = db.prepare('SELECT github_username FROM users WHERE discord_id = ?');
    const row = stmt.get(discord_id);
    return row ? row.github_username : null;
  }
};
