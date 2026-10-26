const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const db = require("../db");
const github = require("../github");
const { DEFAULT_USAGE } = require("../usage");

const repoOption = (opt) =>
  opt.setName("repo").setDescription("Repository").setRequired(true).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("alerts")
    .setDescription("Configure workflow, release and usage alerts")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("route")
        .setDescription("Send a repo's alerts to a channel")
        .addStringOption(repoOption)
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Alert channel").setRequired(true).addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption((opt) =>
          opt.setName("telegram_chat").setDescription("Also send to this Telegram chat (\"none\" clears)").setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("toggle")
        .setDescription("Turn failure or release alerts on/off for a repo")
        .addStringOption(repoOption)
        .addStringOption((opt) =>
          opt
            .setName("type")
            .setDescription("Alert type")
            .setRequired(true)
            .addChoices({ name: "failures", value: "failures" }, { name: "releases", value: "releases" })
        )
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("On or off").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("workflows")
        .setDescription("Workflows whose successes are announced (comma-separated, empty clears)")
        .addStringOption(repoOption)
        .addStringOption((opt) => opt.setName("names").setDescription("e.g. Android Release, Deploy").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("usage")
        .setDescription("Configure Brevo / AWS usage alerts")
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Alert channel").setRequired(true).addChannelTypes(ChannelType.GuildText)
        )
        .addIntegerOption((opt) => opt.setName("brevo_credits").setDescription("Warn below this many Brevo credits"))
        .addNumberOption((opt) => opt.setName("aws_credit_usd").setDescription("Warn below this many USD of AWS credits"))
        .addIntegerOption((opt) => opt.setName("hours").setDescription("Check every N hours").setMinValue(1))
        .addStringOption((opt) =>
          opt.setName("telegram_chat").setDescription("Also send to this Telegram chat (\"none\" clears)").setAutocomplete(true)
        )
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("Show the current alert setup")),

  async autocomplete(interaction) {
    const opt = interaction.options.getFocused(true);
    if (opt.name === "telegram_chat") {
      const chats = await db.listTelegramChats();
      const choices = [{ name: "none", value: "none" }, ...chats.map((c) => ({ name: c.title, value: c.chat_id }))];
      return interaction.respond(choices.filter((c) => c.name.toLowerCase().includes(opt.value.toLowerCase())).slice(0, 25));
    }
    const focused = opt.value.toLowerCase();
    const repos = await github.listOrgRepos();
    const filtered = repos.filter((r) => r.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map((r) => ({ name: r, value: r })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const repo = interaction.options.getString("repo");
    const reply = (content) => interaction.reply({ content, ephemeral: true });
    // undefined = option not given (keep), null = "none" (clear)
    const tgOpt = interaction.options.getString("telegram_chat");
    const telegram = tgOpt === null ? {} : { telegram_chat_id: tgOpt === "none" ? null : tgOpt };

    if (sub === "route") {
      const channel = interaction.options.getChannel("channel");
      await db.upsertRepoAlert(repo, { channel_id: channel.id, ...telegram });
      return reply(`✅ \`${repo}\` alerts now go to ${channel}.`);
    }

    if (sub === "toggle" || sub === "workflows") {
      if (!(await db.getRepoAlert(repo))) return reply(`❌ \`${repo}\` has no alert channel. Run \`/alerts route\` first.`);
      if (sub === "toggle") {
        const type = interaction.options.getString("type");
        const enabled = interaction.options.getBoolean("enabled");
        await db.upsertRepoAlert(repo, { [type]: enabled });
        return reply(`✅ \`${repo}\` ${type} alerts ${enabled ? "on" : "off"}.`);
      }
      const names = interaction.options.getString("names").split(",").map((n) => n.trim()).filter(Boolean);
      await db.upsertRepoAlert(repo, { success_workflows: names });
      return reply(names.length ? `✅ \`${repo}\` will announce: ${names.join(", ")}.` : `✅ Cleared \`${repo}\` success workflows.`);
    }

    if (sub === "usage") {
      const current = { ...DEFAULT_USAGE, ...(await db.getSetting("usage")) };
      const o = interaction.options;
      const next = {
        ...current,
        channel_id: o.getChannel("channel").id,
        brevoWarnBelowCredits: o.getInteger("brevo_credits") ?? current.brevoWarnBelowCredits,
        awsWarnCreditsBelowUsd: o.getNumber("aws_credit_usd") ?? current.awsWarnCreditsBelowUsd,
        checkEveryHours: o.getInteger("hours") ?? current.checkEveryHours,
        ...telegram,
      };
      await db.setSetting("usage", next);
      return reply(
        `✅ Usage alerts → <#${next.channel_id}> · Brevo < ${next.brevoWarnBelowCredits} credits · AWS credits < $${next.awsWarnCreditsBelowUsd} · every ${next.checkEveryHours}h`
      );
    }

    if (sub === "list") {
      const rows = await db.listRepoAlerts();
      const usage = await db.getSetting("usage");
      const on = (b) => (b ? "on" : "off");
      const lines = rows.map(
        (r) =>
          `\`${r.repo}\` → ${r.channel_id ? `<#${r.channel_id}>` : "no channel"}${r.telegram_chat_id ? " + Telegram" : ""} · failures ${on(r.failures)} · releases ${on(r.releases)} · workflows: ${r.success_workflows.length ? r.success_workflows.join(", ") : "none"}`
      );
      lines.push(
        usage?.channel_id
          ? `**Usage** → <#${usage.channel_id}> · Brevo < ${usage.brevoWarnBelowCredits} · AWS < $${usage.awsWarnCreditsBelowUsd} · every ${usage.checkEveryHours}h`
          : "**Usage** → not configured (`/alerts usage`)"
      );
      return reply((rows.length ? "" : "No repo routes yet (`/alerts route`).\n") + lines.join("\n"));
    }
  },
};
