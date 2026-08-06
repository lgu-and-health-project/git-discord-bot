require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits, Partials, Collection } = require("discord.js");
const fs = require("fs");
const path = require("path");

const githubWebhookRouter = require("./routes/githubWebhook");

// Fail loudly and immediately if required config is missing, instead of
// crashing later with an opaque "Application exited early".
const REQUIRED_ENV = ["DISCORD_TOKEN", "GITHUB_TOKEN", "GITHUB_ORG", "DISCORD_ISSUE_CHANNEL_ID"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  console.error("Set these in your host's Environment tab (Render: Settings > Environment).");
  process.exit(1);
}

// Node terminates the process on unhandled promise rejections by default —
// log the real error before that happens so it shows up in the deploy logs.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});

const app = express();

// Keep the raw body around so the GitHub webhook route can verify the
// X-Hub-Signature-256 header.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

discord.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"))) {
  const command = require(path.join(commandsPath, file));
  discord.commands.set(command.data.name, command);
}

discord.once("ready", () => {
  console.log(`Discord bot online as ${discord.user.tag}`);
});

discord.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = discord.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error executing /${interaction.commandName}:`, err);
      const payload = {
        content: "⚠️ Something went wrong running that command.",
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    const command = discord.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error(`Autocomplete error for /${interaction.commandName}:`, err);
    }
  }
});

// Relays messages posted in tracked threads back to GitHub as comments.
require("./events/messageCreate")(discord);

discord.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("Discord login failed — check that DISCORD_TOKEN is correct:", err.message);
  process.exit(1);
});

app.use("/github/webhook", githubWebhookRouter(discord));

app.get("/", (req, res) => {
  res.send("iGit bot online");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
