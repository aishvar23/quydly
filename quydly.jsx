import { useState, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT.CONFIG — single control panel
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: "world",   label: "World",   emoji: "🌍", newsDataTag: "world"         },
  { id: "tech",    label: "Tech",    emoji: "💻", newsDataTag: "technology"    },
  { id: "finance", label: "Finance", emoji: "💰", newsDataTag: "business"      },
  { id: "culture", label: "Culture", emoji: "🎭", newsDataTag: "entertainment" },
  { id: "science", label: "Science", emoji: "⚡", newsDataTag: "science"       },
];

const EDITORIAL_MIX = { world: 2, tech: 1, finance: 1, culture: 1 };

const FLAGS = {
  activeStrategy:          "editorial", // "editorial" | "beat" | "custom"
  premiumEnabled:           false,
  beatEnabled:              false,
  customMixEnabled:         false,
  showStrategyHint:         true,
  freeQuestionsPerDay:      5,
  premiumQuestionsPerDay:   10,
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STRATEGIES
// ─────────────────────────────────────────────────────────────────────────────
const EditorialStrategy = {
  getLabel: () => "Today's Edition",
  getCategoryMix: () => EDITORIAL_MIX,
  isConfigurable: () => false,
  buildPromptCategories: () => {
    const cats = [];
    Object.entries(EDITORIAL_MIX).forEach(([id, count]) => {
      const cat = CATEGORIES.find(c => c.id === id);
      for (let i = 0; i < count; i++) cats.push(cat);
    });
    return cats.sort(() => Math.random() - 0.5);
  },
};

const BeatStrategy = (beat) => ({
  getLabel: () => `Your ${beat.charAt(0).toUpperCase() + beat.slice(1)} Feed`,
  getCategoryMix: () => ({ [beat]: 3, world: 1, finance: 1 }),
  isConfigurable: () => false,
  buildPromptCategories: () => {
    const cat = CATEGORIES.find(c => c.id === beat);
    return [cat, cat, cat, CATEGORIES[0], CATEGORIES[2]];
  },
});

const CustomStrategy = (weights) => ({
  getLabel: () => "Your Mix",
  getCategoryMix: () => weights,
  isConfigurable: () => true,
  buildPromptCategories: () => {
    const cats = [];
    Object.entries(weights).forEach(([id, count]) => {
      const cat = CATEGORIES.find(c => c.id === id);
      for (let i = 0; i < count; i++) cats.push(cat);
    });
    return cats.sort(() => Math.random() - 0.5);
  },
});

function getActiveStrategy() {
  switch (FLAGS.activeStrategy) {
    case "beat":   return BeatStrategy("tech");
    case "custom": return CustomStrategy({ world: 1, tech: 2, finance: 1, culture: 1 });
    default:       return EditorialStrategy;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CREDIT MANAGER
// ─────────────────────────────────────────────────────────────────────────────
function useCreditManager() {
  const todayKey = () => `credits_${new Date().toDateString()}`;
  const getCredits = () => {
    const s = localStorage.getItem(todayKey());
    return s !== null ? parseInt(s) : FLAGS.freeQuestionsPerDay;
  };
  const [credits, setCredits] = useState(getCredits);
  const tier = FLAGS.premiumEnabled ? "premium" : "free";
  const dailyLimit = tier === "premium" ? FLAGS.premiumQuestionsPerDay : FLAGS.freeQuestionsPerDay;
  const canPlay = credits > 0;
  const consumeCredit = () => {
    const next = Math.max(0, credits - 1);
    localStorage.setItem(todayKey(), next);
    setCredits(next);
  };
  const resetForDemo = () => {
    localStorage.removeItem(todayKey());
    setCredits(FLAGS.freeQuestionsPerDay);
  };
  return { credits, tier, dailyLimit, canPlay, consumeCredit, resetForDemo };
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAK MANAGER
// ─────────────────────────────────────────────────────────────────────────────
function useStreakManager() {
  const [streak, setStreak] = useState(() => parseInt(localStorage.getItem("streak") || "0"));
  const recordCompletion = () => {
    const last = localStorage.getItem("last_played");
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    let next = 1;
    if (last === yesterday) next = streak + 1;
    else if (last === today) next = streak;
    localStorage.setItem("streak", next);
    localStorage.setItem("last_played", today);
    setStreak(next);
  };
  return { streak, recordCompletion };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE API
// ─────────────────────────────────────────────────────────────────────────────
async function generateQuestion(category) {
  const prompt = `You are a witty, punchy news quiz writer for "The Daily Dose," a daily news game.

Generate ONE multiple-choice quiz question about a REAL, significant, notable news event in the category: ${category.label}.

Rules:
- Must be about something real and notable that has happened recently in the world
- Punchy, witty, jargon-free — smart but not academic
- 4 options: exactly 1 correct, 3 plausible distractors
- TL;DR: exactly 2 sentences of context on the real story

Respond ONLY with valid JSON (no markdown, no preamble):
{
  "question": "string",
  "options": ["A", "B", "C", "D"],
  "correctIndex": 0,
  "tldr": "Two sentence string.",
  "categoryId": "${category.id}"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=JetBrains+Mono:wght@400;600;700&family=Lato:wght@300;400;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --ink: #0c0b09; --ink2: #161512; --card: #1c1a17; --card2: #242118;
    --cream: #f2ead8; --cream2: #c8bfa8;
    --amber: #e8a020; --amber2: #f5b940;
    --green: #3aaa72; --red: #d94040; --muted: #6b6455;
    --border: rgba(232,160,32,0.15); --border2: rgba(232,160,32,0.3);
  }
  body { background: var(--ink); color: var(--cream); font-family: 'Lato', sans-serif; min-height: 100vh; }
  .app { min-height: 100vh; max-width: 480px; margin: 0 auto; padding: 0 20px 80px; position: relative; }
  .app::after {
    content: ''; position: fixed; inset: 0; z-index: 100; pointer-events: none; opacity: 0.03;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 256px;
  }

  /* Masthead */
  .masthead { padding: 22px 0 16px; border-bottom: 1px solid var(--border2); margin-bottom: 22px; display: flex; align-items: flex-end; justify-content: space-between; }
  .masthead-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: var(--amber); margin-bottom: 4px; }
  .masthead-title { font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 900; line-height: 1; color: var(--cream); letter-spacing: -0.5px; }
  .masthead-title em { color: var(--amber); font-style: normal; }
  .masthead-tagline { font-size: 9px; color: var(--muted); font-family: 'JetBrains Mono', monospace; letter-spacing: 1px; text-transform: uppercase; margin-top: 2px; }
  .streak-badge { display: flex; align-items: center; gap: 5px; background: var(--amber); color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; padding: 6px 11px; border-radius: 20px; white-space: nowrap; }

  /* Stats */
  .stats-bar { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 22px; }
  .stat-chip { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px 8px; text-align: center; }
  .stat-val { font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; color: var(--amber); line-height: 1; }
  .stat-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-top: 4px; font-weight: 600; }

  /* Progress */
  .progress-wrap { margin-bottom: 22px; }
  .progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .progress-label { font-size: 11px; color: var(--muted); font-family: 'JetBrains Mono', monospace; letter-spacing: 0.5px; }
  .progress-track { height: 3px; background: var(--card2); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, var(--amber), var(--amber2)); border-radius: 3px; transition: width 0.7s cubic-bezier(0.34,1.56,0.64,1); }

  /* Cards */
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; animation: slideUp 0.45s cubic-bezier(0.34,1.56,0.64,1); }
  @keyframes slideUp { from { opacity:0; transform: translateY(24px) scale(0.96); } to { opacity:1; transform: translateY(0) scale(1); } }
  @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
  @keyframes pop { 0%{transform:scale(1)} 50%{transform:scale(1.04)} 100%{transform:scale(1)} }
  .card.shake { animation: shake 0.4s ease; }
  .card.pop   { animation: pop 0.3s ease; }

  .topic-tag { display: inline-flex; align-items: center; gap: 5px; background: rgba(232,160,32,0.1); border: 1px solid rgba(232,160,32,0.25); border-radius: 20px; padding: 4px 10px; margin-bottom: 16px; font-size: 10px; font-weight: 700; color: var(--amber); font-family: 'JetBrains Mono', monospace; letter-spacing: 0.5px; text-transform: uppercase; }
  .question-text { font-family: 'Playfair Display', serif; font-size: 19px; font-weight: 700; line-height: 1.5; color: var(--cream); margin-bottom: 24px; }

  /* Wager */
  .section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted); font-weight: 700; margin-bottom: 10px; }
  .wager-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-bottom: 22px; }
  .wager-btn { padding: 9px 4px; background: var(--card2); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; color: var(--muted); transition: all 0.15s ease; text-align: center; }
  .wager-btn:hover { border-color: var(--amber); color: var(--amber); }
  .wager-btn.active { background: rgba(232,160,32,0.12); border-color: var(--amber); color: var(--amber2); }

  /* Answers */
  .answers { display: flex; flex-direction: column; gap: 9px; }
  .answer-btn { width: 100%; display: flex; align-items: center; gap: 12px; padding: 13px 16px; background: var(--card2); border: 1px solid var(--border); border-radius: 11px; cursor: pointer; text-align: left; transition: all 0.15s ease; font-family: 'Lato', sans-serif; }
  .answer-btn:hover:not(:disabled) { border-color: var(--amber); background: rgba(232,160,32,0.06); }
  .answer-btn:disabled { cursor: default; }
  .answer-btn.correct { background: rgba(58,170,114,0.12); border-color: var(--green); }
  .answer-btn.wrong   { background: rgba(217,64,64,0.1);   border-color: var(--red);   }
  .answer-btn.dimmed  { opacity: 0.35; }
  .answer-letter { width: 26px; height: 26px; flex-shrink: 0; border-radius: 6px; background: var(--card); border: 1px solid var(--border); font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; color: var(--muted); display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
  .answer-btn.correct .answer-letter { background: var(--green); border-color: var(--green); color: white; }
  .answer-btn.wrong   .answer-letter { background: var(--red);   border-color: var(--red);   color: white; }
  .answer-text { font-size: 14px; font-weight: 400; color: var(--cream2); line-height: 1.4; }
  .answer-btn.correct .answer-text, .answer-btn.wrong .answer-text { color: var(--cream); font-weight: 700; }

  /* Reveal */
  .reveal-panel { margin-top: 18px; padding: 16px; background: var(--card2); border-radius: 10px; border-left: 3px solid var(--amber); animation: slideUp 0.4s ease; }
  .reveal-label { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: var(--amber); margin-bottom: 7px; }
  .reveal-text { font-size: 13px; line-height: 1.6; color: var(--cream2); font-weight: 300; }
  .points-flash { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 700; margin: 14px 0 4px; animation: pop 0.4s ease; }
  .points-flash.gain { color: var(--green); }
  .points-flash.loss { color: var(--red); }
  .next-btn { width: 100%; margin-top: 18px; padding: 14px; background: var(--amber); color: var(--ink); border: none; border-radius: 11px; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; cursor: pointer; transition: all 0.15s; }
  .next-btn:hover { background: var(--amber2); transform: translateY(-1px); }

  /* Loading */
  .loading-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 48px 24px; text-align: center; }
  .spinner { width: 36px; height: 36px; border: 3px solid var(--border2); border-top-color: var(--amber); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 18px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; }
  .loading-sub  { font-size: 12px; color: var(--muted); margin-top: 6px; font-weight: 300; }

  /* Home */
  .home-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 28px 24px; text-align: center; }
  .home-edition { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: var(--amber); margin-bottom: 10px; }
  .home-headline { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 900; line-height: 1.25; color: var(--cream); margin-bottom: 8px; }
  .home-sub { font-size: 13px; color: var(--muted); font-weight: 300; margin-bottom: 24px; line-height: 1.6; }
  .mix-preview { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin-bottom: 24px; }
  .mix-pill { background: var(--card2); border: 1px solid var(--border); border-radius: 20px; padding: 5px 12px; font-size: 12px; color: var(--cream2); }
  .start-btn { width: 100%; padding: 16px; background: var(--amber); color: var(--ink); border: none; border-radius: 12px; font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700; letter-spacing: 0.5px; cursor: pointer; transition: all 0.15s; }
  .start-btn:hover { background: var(--amber2); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(232,160,32,0.2); }
  .credits-note { margin-top: 12px; font-size: 11px; color: var(--muted); font-family: 'JetBrains Mono', monospace; }

  /* Gate */
  .gate-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px 24px; text-align: center; }
  .gate-icon  { font-size: 48px; margin-bottom: 16px; }
  .gate-title { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 900; color: var(--cream); margin-bottom: 8px; }
  .gate-sub   { font-size: 13px; color: var(--muted); font-weight: 300; line-height: 1.6; margin-bottom: 24px; }
  .countdown  { font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 700; color: var(--amber); margin-bottom: 6px; }
  .countdown-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted); margin-bottom: 24px; }
  .return-btn { width: 100%; padding: 14px; background: var(--card2); border: 1px solid var(--border2); border-radius: 11px; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; color: var(--cream2); letter-spacing: 0.5px; margin-bottom: 10px; transition: all 0.15s; }
  .return-btn:hover { border-color: var(--amber); color: var(--amber); }
  .premium-btn { width: 100%; padding: 14px; background: transparent; border: 1px solid var(--border); border-radius: 11px; cursor: not-allowed; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; }
  .premium-btn .coming-soon { font-size: 9px; display: block; color: var(--amber); opacity: 0.7; margin-top: 2px; letter-spacing: 2px; }

  /* End */
  .end-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 28px 24px; }
  .end-grade       { text-align: center; font-size: 52px; margin-bottom: 4px; }
  .end-grade-label { text-align: center; font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 900; color: var(--cream); margin-bottom: 4px; }
  .end-score       { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--muted); margin-bottom: 22px; }
  .end-rank     { background: rgba(232,160,32,0.08); border: 1px solid var(--border2); border-radius: 10px; padding: 14px; text-align: center; margin-bottom: 20px; }
  .end-rank-val { font-family: 'JetBrains Mono', monospace; font-size: 28px; font-weight: 700; color: var(--amber); }
  .end-rank-lbl { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .mix-breakdown { margin-bottom: 20px; }
  .mix-row       { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .mix-row-label { font-size: 12px; color: var(--cream2); width: 72px; flex-shrink: 0; }
  .mix-bar-track { flex: 1; height: 4px; background: var(--card2); border-radius: 4px; overflow: hidden; }
  .mix-bar-fill  { height: 100%; background: var(--amber); border-radius: 4px; transition: width 1s cubic-bezier(0.34,1.56,0.64,1); }
  .mix-row-count { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted); width: 16px; text-align: right; }
  .customize-hint { text-align: center; font-size: 11px; color: var(--muted); margin-bottom: 16px; padding: 10px; border: 1px dashed var(--border2); border-radius: 8px; }
  .customize-hint span { color: var(--amber); }
  .streak-note { text-align: center; margin-bottom: 14px; font-size: 13px; color: var(--amber); }
  .share-btn    { width: 100%; padding: 14px; background: var(--amber); color: var(--ink); border: none; border-radius: 11px; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 10px; transition: all 0.15s; }
  .share-btn:hover { background: var(--amber2); }
  .play-again-btn { width: 100%; padding: 12px; background: transparent; border: 1px solid var(--border2); border-radius: 11px; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; transition: all 0.15s; }
  .play-again-btn:hover { border-color: var(--amber); color: var(--amber); }

  /* Error */
  .error-card { background: rgba(217,64,64,0.08); border: 1px solid rgba(217,64,64,0.3); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 16px; }
  .error-text { font-size: 13px; color: var(--red); line-height: 1.5; }
  .retry-btn  { margin-top: 12px; padding: 10px 20px; background: var(--red); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-family: 'JetBrains Mono', monospace; font-weight: 700; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
const LETTERS = ["A", "B", "C", "D"];

function getGrade(score, max) {
  const p = score / max;
  if (p >= 0.85) return { emoji: "🏆", label: "Ace" };
  if (p >= 0.65) return { emoji: "🎯", label: "Sharp" };
  if (p >= 0.40) return { emoji: "📰", label: "Informed" };
  return { emoji: "🫠", label: "Caught Slipping" };
}

function getCountdown() {
  const now = new Date(), next = new Date();
  next.setHours(7, 0, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);
  const d = next - now;
  return `${Math.floor(d / 3600000)}h ${Math.floor((d % 3600000) / 60000)}m`;
}

function getEditionNumber() {
  return Math.floor((new Date() - new Date("2025-01-01")) / 86400000) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function Masthead({ streak }) {
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="masthead">
      <div>
        <div className="masthead-eyebrow">{today} · Edition #{getEditionNumber()}</div>
        <div className="masthead-title"><em>Quydly</em></div>
        <div className="masthead-tagline">The daily news game · kwid-lee</div>
      </div>
      {streak > 0 && <div className="streak-badge">🔥 {streak} day{streak !== 1 ? "s" : ""}</div>}
    </div>
  );
}

function StatsBar({ points, credits, answered }) {
  return (
    <div className="stats-bar">
      <div className="stat-chip">
        <div className="stat-val">{points}</div>
        <div className="stat-lbl">Points</div>
      </div>
      <div className="stat-chip">
        <div className="stat-val">{credits}</div>
        <div className="stat-lbl">Left Today</div>
      </div>
      <div className="stat-chip">
        <div className="stat-val">{answered}</div>
        <div className="stat-lbl">Answered</div>
      </div>
    </div>
  );
}

function ProgressBar({ current, total, label }) {
  return (
    <div className="progress-wrap">
      <div className="progress-header">
        <span className="progress-label">{label}</span>
        <span className="progress-label">{current} / {total}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(current / total) * 100}%` }} />
      </div>
    </div>
  );
}

function HomeScreen({ onStart, credits, strategy }) {
  const mix = strategy.getCategoryMix();
  const pills = Object.entries(mix).flatMap(([id, count]) => {
    const cat = CATEGORIES.find(c => c.id === id);
    return Array(count).fill(null).map((_, i) => (
      <span className="mix-pill" key={`${id}-${i}`}>{cat.emoji} {cat.label}</span>
    ));
  });
  return (
    <div className="home-card">
      <div className="home-edition">Quydly · {strategy.getLabel()}</div>
      <div className="home-headline">5 Questions.<br />3 Minutes.<br />Stay Sharp.</div>
      <div className="home-sub">AI-curated from today's real headlines.<br />Wager points. Get smarter.</div>
      <div className="mix-preview">{pills}</div>
      <button className="start-btn" onClick={onStart}>Start Today's Edition →</button>
      <div className="credits-note">{credits} question{credits !== 1 ? "s" : ""} remaining today</div>
    </div>
  );
}

function LoadingCard({ questionNum, total }) {
  return (
    <div className="loading-card">
      <div className="spinner" />
      <div className="loading-text">Scanning headlines...</div>
      <div className="loading-sub">Generating question {questionNum} of {total}</div>
    </div>
  );
}

function QuestionCard({ question, onAnswer, answered, selectedIndex, wager, setWager }) {
  const [anim, setAnim] = useState("");
  const cat = CATEGORIES.find(c => c.id === question.categoryId) || CATEGORIES[0];

  const handleAnswer = (i) => {
    setAnim(i === question.correctIndex ? "pop" : "shake");
    setTimeout(() => setAnim(""), 500);
    onAnswer(i);
  };

  return (
    <div className={`card ${anim}`}>
      <div className="topic-tag">{cat.emoji} {cat.label}</div>
      <div className="question-text">{question.question}</div>

      {!answered && (
        <>
          <div className="section-label">Your Wager</div>
          <div className="wager-row">
            {[10, 25, 50, 100].map(w => (
              <button key={w} className={`wager-btn ${wager === w ? "active" : ""}`} onClick={() => setWager(w)}>
                {w} pts
              </button>
            ))}
          </div>
        </>
      )}

      <div className="answers">
        {question.options.map((opt, i) => {
          let cls = "";
          if (answered) {
            if (i === question.correctIndex) cls = "correct";
            else if (i === selectedIndex) cls = "wrong";
            else cls = "dimmed";
          }
          return (
            <button key={i} className={`answer-btn ${cls}`} onClick={() => !answered && handleAnswer(i)} disabled={answered}>
              <span className="answer-letter">{LETTERS[i]}</span>
              <span className="answer-text">{opt}</span>
            </button>
          );
        })}
      </div>

      {answered && (
        <>
          <div className={`points-flash ${selectedIndex === question.correctIndex ? "gain" : "loss"}`}>
            {selectedIndex === question.correctIndex ? `+${wager}` : `-${Math.floor(wager / 2)}`} pts
          </div>
          <div className="reveal-panel">
            <div className="reveal-label">📰 TL;DR</div>
            <div className="reveal-text">{question.tldr}</div>
          </div>
        </>
      )}
    </div>
  );
}

function GateScreen({ onReset }) {
  const [cd, setCd] = useState(getCountdown());
  useEffect(() => { const t = setInterval(() => setCd(getCountdown()), 60000); return () => clearInterval(t); }, []);
  return (
    <div className="gate-card">
      <div className="gate-icon">🎉</div>
      <div className="gate-title">You're all caught up.</div>
      <div className="gate-sub">You've read today's full Daily Dose.<br />Come back tomorrow for 5 fresh questions.</div>
      <div className="countdown">{cd}</div>
      <div className="countdown-lbl">Until next edition drops</div>
      <button className="return-btn" onClick={onReset}>↺ Reset for demo</button>
      <button className="premium-btn" disabled>
        🔓 Go Premium — 10 questions/day
        <span className="coming-soon">COMING SOON</span>
      </button>
    </div>
  );
}

function EndScreen({ score, maxScore, results, strategy, onPlayAgain, streak }) {
  const grade = getGrade(score, maxScore);
  const rank  = Math.floor(Math.random() * 30) + 60;
  const mix   = strategy.getCategoryMix();
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  const correct = results.filter(r => r.correct).length;

  const handleShare = () => {
    const emoji = results.map(r => r.correct ? "🟨" : "⬛").join("");
    const text = `Quydly — Edition #${getEditionNumber()}\n${grade.emoji} ${grade.label} | ${score} pts\n${emoji}\nBeaten ${rank}% of readers today`;
    navigator.clipboard.writeText(text).catch(() => {});
    alert("Copied to clipboard! Share it anywhere.");
  };

  return (
    <div className="end-card">
      <div className="end-grade">{grade.emoji}</div>
      <div className="end-grade-label">{grade.label}</div>
      <div className="end-score">{score} points · {correct}/5 correct</div>

      <div className="end-rank">
        <div className="end-rank-val">Top {100 - rank}%</div>
        <div className="end-rank-lbl">You beat {rank}% of readers today</div>
      </div>

      <div className="section-label" style={{ marginBottom: 12 }}>Today's Mix</div>
      <div className="mix-breakdown">
        {Object.entries(mix).map(([id, count]) => {
          const cat = CATEGORIES.find(c => c.id === id);
          return (
            <div className="mix-row" key={id}>
              <span className="mix-row-label">{cat.emoji} {cat.label}</span>
              <div className="mix-bar-track"><div className="mix-bar-fill" style={{ width: `${(count / total) * 100}%` }} /></div>
              <span className="mix-row-count">{count}</span>
            </div>
          );
        })}
      </div>

      {FLAGS.showStrategyHint && (
        <div className="customize-hint">Want to tune your mix? <span>My Beat</span> is coming in Premium.</div>
      )}

      {streak > 1 && <div className="streak-note">🔥 {streak} day streak — keep it going!</div>}

      <button className="share-btn" onClick={handleShare}>Share My Score →</button>
      <button className="play-again-btn" onClick={onPlayAgain}>↺ Reset for demo</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
const TOTAL = FLAGS.freeQuestionsPerDay;

export default function App() {
  const strategy = getActiveStrategy();
  const { credits, canPlay, consumeCredit, resetForDemo } = useCreditManager();
  const { streak, recordCompletion } = useStreakManager();

  const [screen, setScreen]       = useState("home");
  const [questions, setQuestions] = useState([]);
  const [currentQ, setCurrentQ]   = useState(0);
  const [answered, setAnswered]   = useState(false);
  const [selectedIdx, setSelected]= useState(null);
  const [wager, setWager]         = useState(25);
  const [points, setPoints]       = useState(() => parseInt(localStorage.getItem("total_points") || "0"));
  const [results, setResults]     = useState([]);
  const [error, setError]         = useState(null);
  const [loadingQ, setLoadingQ]   = useState(0);

  const addPoints = (delta) => {
    setPoints(prev => {
      const next = prev + delta;
      localStorage.setItem("total_points", next);
      return next;
    });
  };

  const handleStart = async () => {
    if (!canPlay) { setScreen("gate"); return; }
    setScreen("loading"); setLoadingQ(1); setError(null);
    setResults([]); setCurrentQ(0); setAnswered(false); setWager(25);
    const queue = strategy.buildPromptCategories().slice(0, TOTAL);
    try {
      const qs = [];
      for (let i = 0; i < TOTAL; i++) {
        setLoadingQ(i + 1);
        qs.push(await generateQuestion(queue[i]));
      }
      setQuestions(qs);
      setScreen("quiz");
    } catch (e) {
      setError("Couldn't generate questions. Please check your connection and try again.");
      setScreen("home");
    }
  };

  const handleAnswer = (idx) => {
    const correct = idx === questions[currentQ].correctIndex;
    const delta   = correct ? wager : -Math.floor(wager / 2);
    addPoints(delta);
    consumeCredit();
    setSelected(idx);
    setAnswered(true);
    setResults(prev => [...prev, { correct, delta, categoryId: questions[currentQ].categoryId }]);
  };

  const handleNext = () => {
    if (currentQ + 1 >= TOTAL) { recordCompletion(); setScreen("end"); }
    else { setCurrentQ(q => q + 1); setAnswered(false); setSelected(null); setWager(25); }
  };

  const handleReset = () => {
    resetForDemo(); setScreen("home"); setQuestions([]); setResults([]); setCurrentQ(0);
  };

  const sessionScore = results.reduce((a, r) => a + Math.max(0, r.delta), 0);

  return (
    <>
      <style>{STYLES}</style>
      <div className="app">
        <Masthead streak={streak} />
        <StatsBar points={points} credits={credits} answered={results.length} />

        {["quiz", "loading"].includes(screen) && (
          <ProgressBar
            current={currentQ + (answered ? 1 : 0)}
            total={TOTAL}
            label={strategy.getLabel()}
          />
        )}

        {error && (
          <div className="error-card">
            <div className="error-text">{error}</div>
            <button className="retry-btn" onClick={() => setError(null)}>Retry</button>
          </div>
        )}

        {screen === "home"    && <HomeScreen onStart={handleStart} credits={credits} strategy={strategy} />}
        {screen === "loading" && <LoadingCard questionNum={loadingQ} total={TOTAL} />}
        {screen === "quiz" && questions[currentQ] && (
          <>
            <QuestionCard
              question={questions[currentQ]}
              onAnswer={handleAnswer}
              answered={answered}
              selectedIndex={selectedIdx}
              wager={wager}
              setWager={setWager}
            />
            {answered && (
              <button className="next-btn" onClick={handleNext}>
                {currentQ + 1 < TOTAL ? "Next Question →" : "See Results →"}
              </button>
            )}
          </>
        )}
        {screen === "gate" && <GateScreen onReset={handleReset} />}
        {screen === "end"  && (
          <EndScreen
            score={sessionScore} maxScore={TOTAL * 100}
            results={results} strategy={strategy}
            onPlayAgain={handleReset} streak={streak}
          />
        )}
      </div>
    </>
  );
}
