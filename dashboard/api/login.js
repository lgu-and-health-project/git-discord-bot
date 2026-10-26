const { sign, checkPassword, SESSION_MS } = require("./_lib");

module.exports = (req, res) => {
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).end();
  if (!checkPassword(req.body?.password)) return res.status(401).json({ error: "wrong password" });
  res.setHeader(
    "Set-Cookie",
    `session=${sign()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`
  );
  res.status(204).end();
};
