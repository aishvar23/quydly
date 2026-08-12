// Structured token-usage telemetry for every Anthropic call in the pipeline.
//
// Why this exists: until 2026-08-11 every call site discarded `msg.usage`, so
// answering "where did $13 of credit go in a day?" meant reconstructing token
// counts by measuring prompt strings against the database. One line per call
// makes that a query instead of an afternoon.
//
// What to do with it: filter Application Insights traces on
// `event == "llm_usage"` and group by `op` for per-call-site cost, or by
// `stop_reason == "max_tokens"` to find calls being truncated by their
// max_tokens cap (the signal that a cap is set too low — see ENRICH_TOKENS in
// lib/enrichment.js).
//
// Contract: never throws. Telemetry must not be able to fail a synthesis, so
// every path here is wrapped and a malformed message degrades to nulls.

// Accepts either an Azure Functions `context.log` (a callable with .warn/.error
// attached), a plain object logger, or nothing at all — the host captures
// console.log from Function code, so that is a safe floor for the lib/* call
// sites that aren't handed a logger.
function resolveEmit(logger) {
  if (typeof logger === "function") return logger;
  if (typeof logger?.log === "function") return logger.log.bind(logger);
  return console.log;
}

/**
 * Emit one `llm_usage` line for a completed Anthropic call.
 *
 * @param {Function|{log:Function}|null|undefined} logger  context.log, or null for console
 * @param {string} op    stable call-site id, e.g. "synthesizer.extract_facts_quotes"
 * @param {object} msg   the Anthropic SDK message response
 * @param {object} [meta] extra correlation fields (cluster_id, story_id, platform, …)
 */
export function logLlmUsage(logger, op, msg, meta = {}) {
  try {
    const usage = msg?.usage ?? {};
    resolveEmit(logger)(JSON.stringify({
      event:  "llm_usage",
      op,
      // Read the model off the RESPONSE, not the request constant: that is the
      // model that actually served the call, which is what a bill reconciles to.
      model:  msg?.model ?? null,
      input_tokens:                usage.input_tokens ?? null,
      output_tokens:               usage.output_tokens ?? null,
      // Present once a call uses cache_control (lib/enrichment.js). A cached
      // prefix that never reports a read means a silent invalidator upstream.
      cache_read_input_tokens:     usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      // "max_tokens" here means the response was cut off mid-JSON — the caller
      // will have fallen back to its empty/default shape.
      stop_reason: msg?.stop_reason ?? null,
      ...meta,
    }));
  } catch {
    // Telemetry is never worth failing a call for.
  }
}
