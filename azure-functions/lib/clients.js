// Lazy-initialised shared clients for all Azure Functions.
// Call getSupabase(), getSbSender(queueName), getRedis() from function handlers.

import { createClient } from "@supabase/supabase-js";
import { ServiceBusClient } from "@azure/service-bus";
import Redis from "ioredis";
import Anthropic from "@anthropic-ai/sdk";

let _supabase  = null;
let _sbClient  = null;
let _redis     = null;
let _anthropic = null;

export function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _supabase;
}

// Returns a ServiceBusSender for the given queue.
// Callers are responsible for closing the sender when done.
export function getSbSender(queueName) {
  if (!_sbClient) {
    _sbClient = new ServiceBusClient(
      process.env.AZURE_SERVICE_BUS_CONNECTION_STRING
    );
  }
  return _sbClient.createSender(queueName);
}

export function getRedis() {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
    });
  }
  return _redis;
}

// Returns null when ANTHROPIC_API_KEY is unset so callers can fall back to
// deterministic generation instead of crashing.
export function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) {
    // Bound every Anthropic call: a per-request 60s timeout + 2 SDK retries,
    // so a stalled connection can never hang past the function timeout / SB
    // lock and wedge a cluster in PROCESSING (2026-06-15 incident root cause).
    _anthropic = new Anthropic({
      apiKey:     process.env.ANTHROPIC_API_KEY,
      timeout:    60_000,
      maxRetries: 2,
    });
  }
  return _anthropic;
}
