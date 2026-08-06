const { SlashCommandBuilder } = require("discord.js");
const db = require("../db");
const github = require("../github");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord account to your GitHub username")
    .addStringOption((opt) =>
      opt.setName("username").setDescription("Your GitHub username").setRequired(true)
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username").trim();

    await interaction.deferReply({ ephemeral: true });

    const exists = await github.userExists(username);
    if (!exists) {
      return interaction.editReply(`❌ Couldn't find a GitHub user called \`${username}\`.`);
    }

    db.linkUser(interaction.user.id, username);
    return interaction.editReply(
      `✅ Linked your Discord account to GitHub user \`${username}\`. Your replies in issue threads will now show up as comments attributed to you.`
    );
  },
};
