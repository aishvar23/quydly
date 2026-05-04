'use strict';

const legalScandal = require('./legal-scandal');
const geopolitics = require('./geopolitics');
const financeMarkets = require('./finance-markets');
const election = require('./election');
const naturalDisaster = require('./natural-disaster');
const techCyber = require('./tech-cyber');
const cultureEntertainment = require('./culture-entertainment');
const general = require('./general');

// Registered types. Add new types to this list.
// Classification: every type whose matches() returns true is a candidate.
// Highest `priority` wins; ties broken by registration order.
// Default priority is 100. Use higher values for narrower / more specific
// types that should beat generalist matches.
const TYPES = [
  legalScandal,
  geopolitics,
  financeMarkets,
  election,
  naturalDisaster,
  techCyber,
  cultureEntertainment,
  general,
];

function classify(story) {
  const matched = TYPES.filter((type) => {
    try {
      return Boolean(type.matches && type.matches(story));
    } catch (_) {
      return false;
    }
  });
  if (matched.length === 0) return null;
  matched.sort((a, b) => (b.priority || 100) - (a.priority || 100));
  return matched[0];
}

function getTypeById(id) {
  return TYPES.find((type) => type.id === id) || null;
}

function listTypeIds() {
  return TYPES.map((type) => type.id);
}

module.exports = {
  TYPES,
  classify,
  getTypeById,
  listTypeIds,
};
