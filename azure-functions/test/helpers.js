// Shared test helpers — loads env from local.settings.json, creates clients.
// Usage: import { supabase, sbClient, redis, env, fakeContext } from './helpers.js';

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";
import { ServiceBusClient } from "@azure/service-bus";
import Redis from "ioredis";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(__dirname, "..", "local.settings.json");
const settings = JSON.parse(readFileSync(settingsPath, "utf8"));

export const env = settings.Values;
Object.assign(process.env, env);

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
export const sbClient = new ServiceBusClient(env.AZURE_SERVICE_BUS_CONNECTION_STRING);
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableReadyCheck: false });

export function fakeContext(name) {
  return {
    log: Object.assign(
      (...args) => console.log(`[${name}]`, ...args),
      {
        error: (...args) => console.error(`[${name}][ERROR]`, ...args),
        warn:  (...args) => console.warn(`[${name}][WARN]`, ...args),
      }
    ),
    bindings: {},
  };
}

export async function cleanup() {
  try {
    await sbClient.close();
  } catch (e) {
    // ignore
  }
  try {
    redis.disconnect();
    // Give redis time to actually disconnect
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (e) {
    // ignore
  }
}
