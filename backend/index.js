import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import express from "express";
import cors from "cors";
import questionsRouter from "./routes/questions.js";
import completeRouter from "./routes/complete.js";
import stripeRouter from "./routes/stripe.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/questions", questionsRouter);
app.use("/api/complete", completeRouter);
app.use("/api/webhook/stripe", stripeRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`[quydly] server running on port ${PORT}`));

export default app;
