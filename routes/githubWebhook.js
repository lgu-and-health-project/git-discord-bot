const express = require("express");
const crypto = require("crypto");
const db = require("../db");

function verifySignature(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured — fine for local testing, not for prod
  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !req.rawBody) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

module.exports = function (discord) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    if (!verifySignature(req)) {
      console.warn("GitHub webhook: invalid signature, rejecting");
      return res.sendStatus(401);
    }

    // Ack immediately — GitHub retries aggressively on slow/failed responses,
    // and any Discord API errors below shouldn't turn into webhook redeliveries.
    res.sendStatus(200);

    const event = req.headers["x-github-event"];
    const { action, issue, comment, repository } = req.body;
    const repo = repository?.full_name;

    try {
      if (event === "issues" && action === "opened") {
        await handleIssueOpened(discord, repo, issue);
      } else if (event === "issues" && action === "closed") {
        await handleIssueClosed(discord, repo, issue);
      } else if (event === "issue_comment" && action === "created") {
        await handleIssueComment(discord, repo, issue, comment);
      }
    } catch (err) {
      console.error("Error handling GitHub webhook event:", err);
    }
  });

  return router;
};

async function handleIssueOpened(discord, repo, issue) {
  const channel = await discord.channels.fetch(process.env.DISCORD_ISSUE_CHANNEL_ID);

  const thread = await channel.threads.create({
    name: `#${issue.number} ${issue.title}`.slice(0, 100),
    message: {
      content: `🟡 **New GitHub Issue** in \`${repo}\`\n\n${
        issue.body || "No description"
      }\n\n${issue.html_url}`,
    },
  });

  db.linkThreadToIssue(thread.id, repo, issue.number, issue.user?.login || null);
}

async function handleIssueClosed(discord, repo, issue) {
  const mapping = db.getThreadByIssue(repo, issue.number);
  if (!mapping) return;

  const thread = await discord.channels.fetch(mapping.thread_id).catch(() => null);
  if (!thread) return;

  await thread.send(`🔴 Issue closed on GitHub by **${issue.closed_by?.login || "someone"}**.`);
  await thread.setArchived(true).catch(() => {});
}

async function handleIssueComment(discord, repo, issue, comment) {
  // Don't echo back comments the bot itself just posted from a Discord message —
  // that would create an infinite Discord <-> GitHub loop.
  if (comment.user?.login === process.env.GITHUB_BOT_USERNAME) return;

  const mapping = db.getThreadByIssue(repo, issue.number);
  if (!mapping) return;

  const thread = await discord.channels.fetch(mapping.thread_id).catch(() => null);
  if (!thread) return;

  await thread.send(`💬 **${comment.user.login}** commented on GitHub:\n${comment.body}`);
}
