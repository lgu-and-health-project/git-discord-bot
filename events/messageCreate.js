const { SlashCommandBuilder } = require("discord.js");
const github = require("../github");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("repos")
    .setDescription("List repositories in the GitHub organization"),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const repos = await github.listOrgRepos();
    if (!repos.length) {
      return interaction.editReply("No repositories found (or the bot token can't see any).");
    }
    const list = repos.map((r) => `• ${r}`).join("\n");
    return interaction.editReply(`**Repositories in ${github.ORG}:**\n${list}`);
  },
};
