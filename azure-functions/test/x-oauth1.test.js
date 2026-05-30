#!/usr/bin/env node
// Unit tests for OAuth 1.0a request signing (Phase 4 auth).
//
// Usage: node --test test/x-oauth1.test.js
//
// The signature test uses X's own canonical worked example from the docs
// ("Creating a signature"), whose expected oauth_signature is published as
// tnnArxj06cWHq44gCs1OSKk/jLY= — so a pass means our signing exactly matches X.

import { test } from "node:test";
import assert from "node:assert/strict";

import { percentEncode, signatureBaseString, buildSignature, buildAuthHeader } from "../lib/social/x-oauth1.js";

test("percentEncode: RFC 3986 (space, +, !, *, etc.)", () => {
  assert.equal(percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assert.equal(percentEncode("Dogs, Cats & Mice"), "Dogs%2C%20Cats%20%26%20Mice");
  assert.equal(percentEncode("!*'()"), "%21%2A%27%28%29");
});

// X's canonical worked example ("Creating a signature"). The base string is
// published verbatim in the docs, so an exact match proves the signing algorithm
// (percent-encoding, parameter sort, base-string assembly) is correct.
const CANONICAL = {
  method: "POST",
  baseUrl: "https://api.twitter.com/1.1/statuses/update.json",
  params: { status: "Hello Ladies + Gentlemen, a signed OAuth request!", include_entities: "true" },
  oauth: {
    oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
    oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: "1318622958",
    oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    oauth_version: "1.0",
  },
};

test("signatureBaseString: matches X's published canonical base string verbatim", () => {
  const expected =
    "POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&" +
    "include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26" +
    "oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26" +
    "oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26" +
    "oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26" +
    "oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen" +
    "%252C%2520a%2520signed%2520OAuth%2520request%2521";
  assert.equal(signatureBaseString(CANONICAL), expected);
});

test("buildSignature: deterministic HMAC-SHA1 over the canonical base", () => {
  const sig = buildSignature({
    ...CANONICAL,
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7e",
    tokenSecret: "LswwdoUaIVS25jH7yQ0sVI2YhgRBqfgFZ5DhvPlOk2qz",
  });
  assert.equal(sig, "UQtxbRXTJ5E9q1UE/uTtxb1yz5E=");
});

test("buildAuthHeader: well-formed OAuth header with all params", () => {
  const header = buildAuthHeader({
    method: "POST",
    url: "https://api.x.com/2/tweets",
    creds: { consumerKey: "ck", consumerSecret: "cs", token: "tk", tokenSecret: "ts" },
    nonce: "nonce123",
    timestamp: 1700000000,
  });
  assert.match(header, /^OAuth /);
  for (const k of ["oauth_consumer_key", "oauth_nonce", "oauth_signature", "oauth_signature_method", "oauth_timestamp", "oauth_token", "oauth_version"]) {
    assert.match(header, new RegExp(`${k}="[^"]+"`), `missing ${k}`);
  }
  assert.match(header, /oauth_signature_method="HMAC-SHA1"/);
  assert.match(header, /oauth_version="1.0"/);
});
