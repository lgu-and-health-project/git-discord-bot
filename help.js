const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show what this bot can do and how to use it"),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle("GitHub ↔ Discord bot — commands")
      .setColor(0x2b2d31)
      .setDescription(
        "This bot keeps GitHub issues and Discord threads in sync. New issues get a thread; replies in that thread become GitHub comments, and vice versa.",
      )
      .addFields(
        {
          name: "🔗 /link `username`",
          value:
            "Link your Discord account to your GitHub username, so your thread replies and created issues show up as *you* on GitHub instead of anonymous.",
        },
        {
          name: "🔓 /unlink",
          value: "Remove your linked GitHub account.",
        },
        {
          name: "📁 /repos",
          value:
            "List every repository in the org, so you know what to target.",
        },
        {
          name: "🟢 /issue create `repo` `title` [body]",
          value:
            "Opens a new issue in the chosen repo and creates a discussion thread for it. `repo` autocompletes as you type.",
        },
        {
          name: "🔴 /issue close [repo] [number]",
          value:
            "Closes an issue. Run it **inside** the issue's thread with no arguments, or specify `repo` + `number` from anywhere.",
        },
        {
          name: "👀 /issue view `repo` `number`",
          value:
            "Shows an issue's title, status, and description without leaving Discord.",
        },
        {
          name: "💬 Replying in an issue thread",
          value:
            "Any message you send inside a thread that's linked to an issue is automatically posted as a comment on that GitHub issue — no command needed.",
        },
      )
      .setFooter({
        text: "Tip: link your GitHub account first so your activity is attributed correctly.",
      });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
