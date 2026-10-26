require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits, Partials, Collection } = require("discord.js");
const fs = require("fs");
const path = require("path");

const githubWebhookRouter = require("./routes/githubWebhook");

// Fail loudly and immediately if required config is missing, instead of
// crashing later with an opaque "Application exited early".
const REQUIRED_ENV = ["DISCORD_TOKEN", "GITHUB_TOKEN", "GITHUB_ORG", "DISCORD_ISSUE_CHANNEL_ID", "DATABASE_URL"];
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

discord.once("clientReady", () => {
  console.log(`Discord bot online as ${discord.user.tag}`);

  // Ticks every 15 min but only checks every checkEveryHours, so a changed
  // interval takes effect without a restart. Cost Explorer bills per request.
  const { DEFAULT_USAGE, runUsageCheck } = require("./usage");
  let lastRun = 0;
  const tick = async () => {
    try {
      const { checkEveryHours } = { ...DEFAULT_USAGE, ...(await require("./db").getSetting("usage")) };
      if (Date.now() - lastRun < checkEveryHours * 3600e3) return;
      lastRun = Date.now();
      await runUsageCheck(discord);
    } catch (err) {
      console.error("Usage check failed:", err);
    }
  };
  tick();
  setInterval(tick, 15 * 60e3);
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

if (process.env.TELEGRAM_BOT_TOKEN) require("./telegram").startPolling(require("./db"));

// Relays messages posted in tracked threads back to GitHub as comments.
require("./events/messageCreate")(discord);

(async () => {
  try {
    await require("./db").init();
  } catch (err) {
    console.error("Database init failed — check DATABASE_URL:", err.message);
    process.exit(1);
  }
  // Login can hang silently (e.g. Discord rate-limiting a shared host IP), so log the handshake.
  discord.on("debug", (m) => { if (!/heartbeat/i.test(m)) console.log("[discord]", m); });
  discord.rest.on("rateLimited", (info) => console.warn("[discord] REST rate limited:", JSON.stringify(info)));
  setTimeout(() => {
    if (!discord.isReady()) console.warn("[discord] still not connected after 60s — see [discord] lines above");
  }, 60e3);
  console.log("Logging in to Discord…");
  discord.login(process.env.DISCORD_TOKEN).catch((err) => {
    // No exit: the host would restart us in a loop, and each retry hits Discord's API
    // until Cloudflare bans the shared IP. Fix the cause, then restart the service.
    const hint = /disallowed intents/i.test(err.message)
      ? "enable Message Content Intent (Developer Portal → Bot)"
      : "check that DISCORD_TOKEN is correct";
    console.error(`Discord login failed — ${hint}, then restart the service:`, err.message);
  });
})();

app.use("/github/webhook", githubWebhookRouter(discord));

app.get("/", (req, res) => {
  res.send("iGit bot online");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
