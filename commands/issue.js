const { SlashCommandBuilder } = require("discord.js");
const db = require("../db");
const github = require("../github");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("issue")
    .setDescription("Create, close, or view GitHub issues")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a new GitHub issue")
        .addStringOption((opt) =>
          opt
            .setName("repo")
            .setDescription("Repository")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName("title").setDescription("Issue title").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("body").setDescription("Issue description").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("close")
        .setDescription("Close a GitHub issue")
        .addStringOption((opt) =>
          opt
            .setName("repo")
            .setDescription("Repository (optional if run inside an issue thread)")
            .setAutocomplete(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("number")
            .setDescription("Issue number (optional if run inside an issue thread)")
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View a GitHub issue")
        .addStringOption((opt) =>
          opt
            .setName("repo")
            .setDescription("Repository")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption((opt) =>
          opt.setName("number").setDescription("Issue number").setRequired(true)
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const repos = await github.listOrgRepos();
    const filtered = repos.filter((r) => r.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map((r) => ({ name: r, value: r })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "create") return createIssue(interaction);
    if (sub === "close") return closeIssue(interaction);
    if (sub === "view") return viewIssue(interaction);
  },
};

async function createIssue(interaction) {
  const repo = interaction.options.getString("repo");
  const title = interaction.options.getString("title");
  const body = interaction.options.getString("body") || "";
  const githubUsername = db.getGithubUsername(interaction.user.id);

  await interaction.deferReply();

  const attribution = githubUsername
    ? `Opened via Discord by @${githubUsername} (${interaction.user.tag})`
    : `Opened via Discord by ${interaction.user.tag} (no linked GitHub account — use /link)`;

  const fullBody = `${body}\n\n---\n_${attribution}_`;

  let issue;
  try {
    issue = await github.createIssue(repo, title, fullBody);
  } catch (err) {
    console.error("createIssue failed:", err);
    return interaction.editReply(
      `❌ Couldn't create the issue. Is \`${repo}\` a valid repo in ${github.ORG}?`
    );
  }

  let thread;
  try {
    thread = await interaction.channel.threads.create({
      name: `#${issue.number} ${issue.title}`.slice(0, 100),
      message: { content: `🟢 Issue created in \`${repo}\`: ${issue.html_url}` },
    });
    db.linkThreadToIssue(thread.id, repo, issue.number, interaction.user.id);
  } catch (err) {
    console.error("Thread creation failed:", err);
  }

  return interaction.editReply(
    `✅ Created ${issue.html_url}${thread ? ` — discussion thread: ${thread}` : ""}`
  );
}

async function closeIssue(interaction) {
  let repo = interaction.options.getString("repo");
  let number = interaction.options.getInteger("number");

  if (!repo || !number) {
    const mapping = interaction.channel?.isThread()
      ? db.getIssueByThread(interaction.channel.id)
      : null;
    if (mapping) {
      repo = repo || mapping.repo;
      number = number || mapping.issue_number;
    }
  }

  if (!repo || !number) {
    return interaction.reply({
      content: "Run this inside an issue thread, or provide both `repo` and `number`.",
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  try {
    await github.closeIssue(repo, number);
  } catch (err) {
    console.error("closeIssue failed:", err);
    return interaction.editReply(`❌ Couldn't close #${number} in \`${repo}\`.`);
  }

  return interaction.editReply(`🔴 Closed \`${repo}#${number}\`.`);
}

async function viewIssue(interaction) {
  const repo = interaction.options.getString("repo");
  const number = interaction.options.getInteger("number");

  await interaction.deferReply();

  let issue;
  try {
    issue = await github.getIssue(repo, number);
  } catch (err) {
    return interaction.editReply(`❌ Couldn't find \`${repo}#${number}\`.`);
  }

  const status = issue.state === "open" ? "🟢 open" : "🔴 closed";
  const description = (issue.body || "No description").slice(0, 500);

  return interaction.editReply(
    `**${issue.title}** (\`${repo}#${number}\`) — ${status}\n${description}\n${issue.html_url}`
  );
}
