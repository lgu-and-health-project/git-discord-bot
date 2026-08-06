const { SlashCommandBuilder } = require("discord.js");
const db = require("../db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Remove your linked GitHub account"),

  async execute(interaction) {
    db.unlinkUser(interaction.user.id);
    await interaction.reply({ content: "✅ Unlinked your GitHub account.", ephemeral: true });
  },
};
