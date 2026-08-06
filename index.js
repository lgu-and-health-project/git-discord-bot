const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "data.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS user_links (
    discord_id TEXT PRIMARY KEY,
    github_username TEXT NOT NULL,
    linked_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS issue_threads (
    thread_id TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repo, issue_number)
  );
`);

module.exports = {
  // --- account linking -----------------------------------------------
  linkUser(discordId, githubUsername) {
    db.prepare(
      `INSERT INTO user_links (discord_id, github_username) VALUES (?, ?)
       ON CONFLICT(discord_id) DO UPDATE SET github_username = excluded.github_username`
    ).run(discordId, githubUsername);
  },

  unlinkUser(discordId) {
    db.prepare(`DELETE FROM user_links WHERE discord_id = ?`).run(discordId);
  },

  getGithubUsername(discordId) {
    const row = db
      .prepare(`SELECT github_username FROM user_links WHERE discord_id = ?`)
      .get(discordId);
    return row ? row.github_username : null;
  },

  // --- thread <-> issue mapping ---------------------------------------
  linkThreadToIssue(threadId, repo, issueNumber, createdBy) {
    db.prepare(
      `INSERT INTO issue_threads (thread_id, repo, issue_number, created_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET repo = excluded.repo, issue_number = excluded.issue_number`
    ).run(threadId, repo, issueNumber, createdBy || null);
  },

  getIssueByThread(threadId) {
    return (
      db.prepare(`SELECT * FROM issue_threads WHERE thread_id = ?`).get(threadId) || null
    );
  },

  getThreadByIssue(repo, issueNumber) {
    return (
      db
        .prepare(`SELECT * FROM issue_threads WHERE repo = ? AND issue_number = ?`)
        .get(repo, issueNumber) || null
    );
  },
};
