// Lazy-initialised shared clients for all Azure Functions.
// Call getSupabase(), getSbSender(queueName), getRedis() from function handlers.

import { createClient } from "@supabase/supabase-js";
import { ServiceBusClient } from "@azure/service-bus";
import Redis from "ioredis";

let _supabase = null;
let _sbClient = null;
let _redis    = null;

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
