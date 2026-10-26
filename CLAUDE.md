# Agent instructions

- **No AI attribution in git.** Never add `Co-Authored-By` trailers, "Generated with Claude Code" lines, or any other agent/AI authorship to commit messages, PR descriptions, or code comments.
- **Branches:** `main` is beta, `prod` is stable. Render deploys only from `prod`. Merge feature work into `main`, and promote to `prod` only when it should go live.
