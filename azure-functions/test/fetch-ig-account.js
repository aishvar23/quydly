#!/usr/bin/env node
// Resolve the Instagram Business Account ID (+ Page id and Page access token)
// from a long-lived Meta token, via GET /me/accounts (setup guide step 10).
//
// Reads the token from local.settings.json (any of META_USER_ACCESS_TOKEN /
// META_LONG_LIVED_USER_ACCESS_TOKEN / META_PAGE_ACCESS_TOKEN) or argv[2], and
// META_GRAPH_VERSION (default v21.0). Prints the env lines to paste back.
//
// Usage:
//   node test/fetch-ig-account.js                 # token from local.settings.json
//   node test/fetch-ig-account.js <LONG_LIVED_TOKEN>

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const settings = JSON.parse(readFileSync(join(__dirname, "..", "local.settings.json"), "utf8"));
  Object.assign(process.env, settings.Values);
} catch { /* fine — token may come from argv */ }

const token =
  process.argv[2] ||
  process.env.META_USER_ACCESS_TOKEN ||
  process.env.META_LONG_LIVED_USER_ACCESS_TOKEN ||
  process.env.META_PAGE_ACCESS_TOKEN;
const ver = process.env.META_GRAPH_VERSION || "v21.0";

if (!token) {
  console.error("No token. Pass it as an arg, or set META_USER_ACCESS_TOKEN in local.settings.json.");
  process.exit(1);
}

const uri = `https://graph.facebook.com/${ver}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`;

try {
  const res = await fetch(uri);
  const body = await res.json();
  if (body.error) throw new Error(`${body.error.message} (code ${body.error.code})`);

  const pages = body.data || [];
  if (!pages.length) {
    console.error("\n⚠ No Pages returned. Usually means the token lacks pages_show_list (or business_management),");
    console.error("  or your Facebook user is not an admin of any Page. Regenerate the token with those scopes.\n");
    process.exit(1);
  }

  console.log(`\nFound ${pages.length} Page(s):\n`);
  let igPage = null;
  for (const p of pages) {
    const ig = p.instagram_business_account;
    console.log(`• Page "${p.name}"  id=${p.id}  ig=${ig ? `${ig.id} (@${ig.username})` : "— NOT LINKED —"}`);
    if (ig && !igPage) igPage = p;
  }

  if (!igPage) {
    console.error("\n⚠ No Page has a linked instagram_business_account. Link the IG Professional account to the");
    console.error("  Quydly Page in Meta Business Suite → Settings → Accounts → Instagram, then re-run.\n");
    process.exit(1);
  }

  console.log("\n=== Paste into local.settings.json Values (and Azure Function App settings) ===\n");
  console.log(`META_PAGE_ID=${igPage.id}`);
  console.log(`META_PAGE_ACCESS_TOKEN=${igPage.access_token}`);
  console.log(`INSTAGRAM_BUSINESS_ACCOUNT_ID=${igPage.instagram_business_account.id}`);
  console.log(`META_GRAPH_VERSION=${ver}`);
  console.log("\nUse META_PAGE_ACCESS_TOKEN (not the user token) for publishing. Then run:");
  console.log("  node test/verify-ig-carousel.js          # dry-run, no post");
  console.log("  node test/verify-ig-carousel.js --live   # real carousel (after confirmation)\n");
} catch (err) {
  console.error(`\n❌ /me/accounts failed: ${err.message}\n`);
  process.exit(1);
}
