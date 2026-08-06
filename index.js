require("dotenv").config();

const express = require("express");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send("GitHub Discord Bot online");
});

app.post("/github/webhook", (req, res) => {
    const event = req.headers["x-github-event"];

    console.log("GitHub Event:", event);
    console.log(req.body);

    res.status(200).send("received");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
