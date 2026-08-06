const { Octokit } = require("@octokit/rest");

const ORG = process.env.GITHUB_ORG;
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

module.exports = {
  ORG,
  
  async listOrgRepos() {
    const repos = await octokit.paginate(octokit.rest.repos.listForOrg, {
      org: ORG,
      type: "all",
    });
    return repos.map((r) => r.name);
  },

  async userExists(username) {
    try {
      await octokit.rest.users.getByUsername({ username });
      return true;
    } catch {
      return false;
    }
  },

  async createIssue(repo, title, body) {
    const res = await octokit.rest.issues.create({
      owner: ORG,
      repo,
      title,
      body,
    });
    return res.data;
  },

  async closeIssue(repo, issue_number) {
    await octokit.rest.issues.update({
      owner: ORG,
      repo,
      issue_number,
      state: "closed",
    });
  },

  async getIssue(repo, issue_number) {
    const res = await octokit.rest.issues.get({
      owner: ORG,
      repo,
      issue_number,
    });
    return res.data;
  },

  async addComment(repo, issue_number, body) {
    await octokit.rest.issues.createComment({
      owner: ORG,
      repo,
      issue_number,
      body,
    });
  }
};
