const { SlashCommandBuilder } = require("discord.js");
const { runUsageCheck } = require("../usage");

const usd = (n) => `$${n.toFixed(2)}`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show Brevo and AWS Rekognition usage"),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    // Also posts any newly due alerts to the usage channel — intended.
    const { snapshot: s } = await runUsageCheck(interaction.client);

    const brevo = s.brevoError
      ? `⚠️ ${s.brevoError}`
      : `${s.brevo.credits} credits (${s.brevo.planType})`;
    const aws = s.awsError
      ? `⚠️ ${s.awsError}`
      : `${usd(s.aws.grossUsd)} gross / ${usd(s.aws.netUsd)} net this month · ${
          s.aws.creditsLeftUsd === null ? "credit balance unavailable" : `${usd(s.aws.creditsLeftUsd)} credits left`
        }`;

    return interaction.editReply(`**Brevo:** ${brevo}\n**AWS Rekognition:** ${aws}`);
  },
};
