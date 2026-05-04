'use strict';

// Shared retry helper for external HTTP calls (Mapbox, ElevenLabs).
// Behaviour:
//   - 2xx and 4xx responses return as-is (callers handle 4xx — usually permanent).
//   - 5xx responses retry with exponential backoff (default attempts: 3 total).
//   - Network errors (fetch threw) retry the same way.
//   - On final failure, returns the last response or rethrows the last network error.
async function fetchWithRetry(url, init = {}, options = {}) {
  const { retries = 2, delays = [400, 1500, 4000] } = options;
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      // 4xx — auth, bad request, etc. Permanent. Caller handles.
      if (response.status >= 400 && response.status < 500) return response;
      // 5xx — transient. Maybe retry.
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }

    if (attempt < retries) {
      await sleep(delays[attempt] ?? delays[delays.length - 1]);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error('fetchWithRetry exhausted retries with no response');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  fetchWithRetry,
};
