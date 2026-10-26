const test = require("node:test");
const assert = require("node:assert/strict");

// Neon drops idle connections; an unhandled pool 'error' event would crash the bot.
test("idle connection errors don't crash the process", () => {
  const { pool } = require("../db");
  assert.doesNotThrow(() => pool.emit("error", new Error("terminating connection due to idle timeout")));
  const { db } = require("../dashboard/api/_lib");
  assert.doesNotThrow(() => db().emit("error", new Error("idle")));
});
