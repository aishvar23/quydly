'use strict';

const axios = require('axios');

function hasSupabase() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

function headers() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const result = {
    apikey: key,
    Accept: 'application/json',
  };

  // Legacy service_role keys are JWTs. New secret keys should only be sent
  // through the apikey header.
  if (typeof key === 'string' && key.split('.').length === 3) {
    result.Authorization = `Bearer ${key}`;
  }

  return result;
}

async function selectRows(table, query) {
  if (!hasSupabase()) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  }

  const base = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const url = `${base}/rest/v1/${table}?${query}`;
  const response = await axios.get(url, {
    headers: headers(),
    timeout: 15000,
  });

  return response.data;
}

module.exports = {
  hasSupabase,
  selectRows,
};
