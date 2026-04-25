import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import { generateDaily } from "./generateDaily.js";

const audience = process.argv[2] ?? "global";

console.log(`[generateDailySilent] running for audience="${audience}" (emails suppressed)`);

generateDaily(audience, { silent: true })
  .then((questions) => {
    console.log(`[generateDailySilent] done — ${questions.length} questions generated`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[generateDailySilent] fatal:", err);
    process.exit(1);
  });
