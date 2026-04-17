#!/usr/bin/env node
// Smoke test 6.7 — Seed 50 raw_articles rows (status=DONE, clustered_at=NULL),
// then run the article-clusterer function, then verify clusters + synthesize-queue.
//
// Usage: node test/smoke-clusterer.js
//
// This seeds synthetic articles with overlapping entities so the clusterer
// can actually form clusters. Uses real-ish entity patterns.

import articleClusterer from "../article-clusterer/index.js";
import { hashUrl } from "../lib/canonicalise.js";
import { supabase, sbClient, fakeContext, cleanup } from "./helpers.js";

const ctx = fakeContext("smoke-clusterer");

const STORY_TEMPLATES = [
  {
    entities: ["Federal Reserve", "Jerome Powell", "Interest Rates"],
    category: "business",
    domains: ["reuters.com", "bloomberg.com", "wsj.com", "ft.com", "cnbc.com"],
    titleBase: "Federal Reserve Signals Rate Decision",
  },
  {
    entities: ["OpenAI", "Sam Altman", "GPT"],
    category: "tech",
    domains: ["techcrunch.com", "theverge.com", "wired.com", "arstechnica.com", "zdnet.com"],
    titleBase: "OpenAI Announces New AI Model",
  },
  {
    entities: ["European Union", "Climate Policy", "Carbon Emissions"],
    category: "world",
    domains: ["bbc.com", "theguardian.com", "france24.com", "dw.com", "aljazeera.com"],
    titleBase: "EU Proposes Stricter Climate Regulations",
  },
  {
    entities: ["NASA", "Mars Mission", "Space Exploration"],
    category: "science",
    domains: ["space.com", "nasa.gov", "arstechnica.com", "bbc.com", "npr.org"],
    titleBase: "NASA Mars Rover Makes Significant Discovery",
  },
  {
    entities: ["WHO", "Vaccine Development", "Global Health"],
    category: "health",
    domains: ["who.int", "reuters.com", "bbc.com", "nature.com", "theguardian.com"],
    titleBase: "WHO Updates Global Vaccination Guidelines",
  },
];

try {
  console.log("\n=== Phase 6.7: Clusterer Smoke Test ===\n");

  // Seed 50 raw_articles (10 per story template, from different domains)
  console.log("Seeding 50 synthetic raw_articles...");
  const seeded = [];

  for (const tmpl of STORY_TEMPLATES) {
    for (let i = 0; i < 10; i++) {
      const domain = tmpl.domains[i % tmpl.domains.length];
      const url = `https://${domain}/test-cluster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const url_hash = hashUrl(url);
      const entityMention = tmpl.entities.join(", ");

      const row = {
        url_hash,
        canonical_url:  url,
        domain,
        category_id:    tmpl.category,
        title:          `${tmpl.titleBase} — variant ${i + 1} from ${domain}`,
        description:    `${entityMention}: This article covers the latest developments. Source: ${domain}`,
        content:        `${tmpl.titleBase}. ${entityMention} are central to this story. ` +
                        `Multiple sources confirm the developments reported by ${domain}. ` +
                        `Experts weigh in on the implications of these events. `.repeat(5),
        content_hash:   hashUrl(url + "-content"),
        author:         "Test Author",
        published_at:   new Date(Date.now() - Math.random() * 12 * 60 * 60 * 1000).toISOString(),
        authority_score: 0.6 + Math.random() * 0.4,
        status:         "DONE",
        is_verified:    false,
        clustered_at:   null,
      };

      seeded.push(row);
    }
  }

  // Insert in batches
  for (let i = 0; i < seeded.length; i += 25) {
    const batch = seeded.slice(i, i + 25);
    const { error } = await supabase
      .from("raw_articles")
      .upsert(batch, { onConflict: "url_hash", ignoreDuplicates: true });
    if (error) console.error("Insert error:", error.message);
  }
  console.log(`Inserted ${seeded.length} raw_articles (status=DONE, clustered_at=NULL)`);

  // Count clusters before
  const { count: clustersBefore } = await supabase
    .from("clusters")
    .select("*", { count: "exact", head: true });

  // Run clusterer
  console.log("\nRunning article-clusterer...");
  const start = Date.now();
  await articleClusterer(ctx, { isPastDue: false });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Clusterer completed in ${elapsed}s`);

  // Count clusters after
  const { count: clustersAfter } = await supabase
    .from("clusters")
    .select("*", { count: "exact", head: true });

  const newClusters = clustersAfter - clustersBefore;
  console.log(`Clusters: ${clustersBefore} → ${clustersAfter} (+${newClusters} new)`);

  // Check articles got marked as clustered
  const { count: stillUnclustered } = await supabase
    .from("raw_articles")
    .select("*", { count: "exact", head: true })
    .eq("status", "DONE")
    .is("clustered_at", null)
    .in("url_hash", seeded.map(s => s.url_hash));

  console.log(`Seeded articles still unclustered: ${stillUnclustered}`);

  // Peek synthesize-queue
  const receiver = sbClient.createReceiver("synthesize-queue", { receiveMode: "peekLock" });
  const peeked = await receiver.peekMessages(10);
  console.log(`\nPeeked ${peeked.length} messages in synthesize-queue:`);
  for (const msg of peeked) {
    console.log(`  - cluster_id: ${msg.body?.cluster_id}, category: ${msg.body?.category_id}`);
  }
  await receiver.close();

  // Summary
  console.log("\n--- Result ---");
  if (newClusters > 0) {
    console.log(`PASS: ${newClusters} clusters created, ${peeked.length} queued for synthesis`);
  } else {
    console.log("WARN: 0 new clusters — check entity extraction and matching logic");
  }
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
}
