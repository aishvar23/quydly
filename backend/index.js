require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const express = require("express");
const cors = require("cors");

const questionsRouter = require("./routes/questions");
const completeRouter = require("./routes/complete");
const stripeRouter = require("./routes/stripe");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/questions", questionsRouter);
app.use("/api/complete", completeRouter);
app.use("/api/webhook/stripe", stripeRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`[quydly] server running on port ${PORT}`));

module.exports = app;
