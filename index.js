require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");

const app = express();

app.use(express.json());

const discord = new Client({
  intents: [GatewayIntentBits.Guilds],
});

discord.once("ready", () => {
  console.log(`Discord bot online as ${discord.user.tag}`);
});

discord.login(process.env.DISCORD_TOKEN);

// GitHub webhook
app.post("/github/webhook", async (req, res) => {
  const event = req.headers["x-github-event"];

  console.log("GitHub Event:", event);

  if (event === "issues") {
    const action = req.body.action;
    const issue = req.body.issue;

    console.log({
      action,
      title: issue.title,
      body: issue.body,
    });

    if (action === "opened") {
      const channel = await discord.channels.fetch(
        process.env.DISCORD_ISSUE_CHANNEL_ID,
      );

      await channel.threads.create({
        name: `#${issue.number} ${issue.title}`,
        message: {
          content: `🟡 **New GitHub Issue**

${issue.body || "No description"}

GitHub:
${issue.html_url}`,
        },
      });

      console.log("Discord thread created");
    }
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("iGit bot online");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
