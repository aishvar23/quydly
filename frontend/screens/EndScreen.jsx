import { useRef, useEffect, useMemo, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView,
  Animated, useWindowDimensions,
} from "react-native";
import { CATEGORIES } from "../../config/categories";
import FLAGS from "../../config/flags";
import SaveStreakModal from "../components/SaveStreakModal";

// ── Tokens ────────────────────────────────────────────────────────────────────
const T = {
  ink:     "#0c0b09",
  card:    "#1c1a17",
  card2:   "#242118",
  cream:   "#f2ead8",
  cream2:  "#c8bfa8",
  amber:   "#e8a020",
  amber2:  "#f5b940",
  green:   "#3aaa72",
  muted:   "#6b6455",
  border:  "rgba(232,160,32,0.15)",
  border2: "rgba(232,160,32,0.30)",
};

const FONT = {
  display: "PlayfairDisplay-Black",
  mono:    "JetBrainsMono-Bold",
  monoReg: "JetBrainsMono-Regular",
  body:    "Lato-Regular",
};

const MAX_WIDTH  = 900;
const BASE_WIDTH = 390;

// ── Helpers ───────────────────────────────────────────────────────────────────
function getEditionNumber() {
  return Math.floor((new Date() - new Date("2025-01-01")) / 86400000) + 1;
}

// Grade thresholds from SPEC.md
function getGrade(score, maxScore) {
  const p = score / maxScore;
  if (p >= 0.85) return { emoji: "🏆", label: "Ace" };
  if (p >= 0.65) return { emoji: "🎯", label: "Sharp" };
  if (p >= 0.40) return { emoji: "📰", label: "Informed" };
  return { emoji: "🫠", label: "Caught Slipping" };
}

// ── Scaled styles ─────────────────────────────────────────────────────────────
function makeStyles(scale) {
  const s = (v) => v * scale;
  return {
    container: { flex: 1, backgroundColor: T.ink },
    content:   { flexGrow: 1, maxWidth: MAX_WIDTH, alignSelf: "center", width: "100%", paddingHorizontal: s(20), paddingTop: s(16), paddingBottom: s(24) },

    card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: s(16), padding: s(28) },

    // Grade
    gradeEmoji: { textAlign: "center", fontSize: s(52), marginBottom: s(4) },
    gradeLabel: { fontFamily: FONT.display, fontSize: s(22), fontWeight: "900", color: T.cream, textAlign: "center", marginBottom: s(4) },
    gradeScore: { fontFamily: FONT.mono, fontSize: s(13), color: T.muted, textAlign: "center", marginBottom: s(22) },

    // Rank
    rankBox:  { backgroundColor: "rgba(232,160,32,0.08)", borderWidth: 1, borderColor: T.border2, borderRadius: s(10), padding: s(14), alignItems: "center", marginBottom: s(20) },
    rankVal:  { fontFamily: FONT.mono, fontSize: s(28), fontWeight: "700", color: T.amber },
    rankLbl:  { fontFamily: FONT.body, fontSize: s(11), color: T.muted, marginTop: s(2) },

    // Mix breakdown
    sectionLabel: { fontFamily: FONT.mono, fontSize: s(9), textTransform: "uppercase", letterSpacing: s(1.5), color: T.muted, fontWeight: "700", marginBottom: s(12) },
    mixRow:       { flexDirection: "row", alignItems: "center", gap: s(10), marginBottom: s(8) },
    mixRowLabel:  { fontFamily: FONT.body, fontSize: s(12), color: T.cream2, width: s(72) },
    mixBarTrack:  { flex: 1, height: s(4), backgroundColor: T.card2, borderRadius: s(4), overflow: "hidden" },
    mixBarFill:   { height: "100%", backgroundColor: T.amber, borderRadius: s(4) },
    mixRowCount:  { fontFamily: FONT.mono, fontSize: s(11), color: T.muted, width: s(16), textAlign: "right" },

    // Strategy hint
    strategyHint:     { marginBottom: s(16), padding: s(10), borderWidth: 1, borderStyle: "dashed", borderColor: T.border2, borderRadius: s(8), alignItems: "center" },
    strategyHintText: { fontFamily: FONT.body, fontSize: s(11), color: T.muted, textAlign: "center" },
    strategyHintAccent: { color: T.amber },

    // Streak note
    streakNote: { textAlign: "center", marginBottom: s(14), fontFamily: FONT.body, fontSize: s(13), color: T.amber },

    // Buttons
    shareBtn:         { width: "100%", paddingVertical: s(14), backgroundColor: T.amber, borderRadius: s(11), alignItems: "center", marginBottom: s(10) },
    shareBtnCopied:   { width: "100%", paddingVertical: s(14), backgroundColor: T.green, borderRadius: s(11), alignItems: "center", marginBottom: s(10) },
    shareBtnText:     { fontFamily: FONT.mono, fontSize: s(13), fontWeight: "700", letterSpacing: s(0.5), color: T.ink },
    playAgainBtn:     { width: "100%", paddingVertical: s(12), backgroundColor: "transparent", borderWidth: 1, borderColor: T.border2, borderRadius: s(11), alignItems: "center" },
    playAgainBtnText: { fontFamily: FONT.mono, fontSize: s(11), fontWeight: "700", color: T.muted, letterSpacing: s(0.5) },
  };
}

// ── Animated mix bar ──────────────────────────────────────────────────────────
function MixBar({ pct, styles }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 1000, useNativeDriver: false }).start();
  }, []);

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  return (
    <View style={styles.mixBarTrack}>
      <Animated.View style={[styles.mixBarFill, { width }]} />
    </View>
  );
}

// ── EndScreen ─────────────────────────────────────────────────────────────────
// Props:
//   score     — number  (session score — sum of positive deltas)
//   maxScore  — number  (FLAGS.freeQuestionsPerDay * 100)
//   results   — [{ correct, delta, categoryId }]
//   strategy  — ContentStrategy
//   streak    — number
//   rank      — number | null  (from POST /api/complete response)
//   onPlayAgain — () => void
export default function EndScreen({ score, maxScore, results, strategy, streak, rank, promptSaveStreak, supabase, onStreakSaved, onPlayAgain, onBeforeOAuth }) {
  const { width } = useWindowDimensions();
  const scale  = Math.min(Math.min(width, MAX_WIDTH) / BASE_WIDTH, 1.0);
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const [copied, setCopied] = useState(false);
  const grade   = getGrade(score, maxScore);
  const mix     = strategy.getCategoryMix();
  const total   = Object.values(mix).reduce((a, b) => a + b, 0);
  const correct = results.filter((r) => r.correct).length;

  // Rank display — use API rank if available, otherwise derive from score
  const beatenPct = rank ? Math.min(Math.max(100 - rank, 1), 99) : Math.floor((score / maxScore) * 73);
  const topPct    = 100 - beatenPct;

  const handleShare = () => {
    const emoji = results.map((r) => (r.correct ? "🟨" : "⬛")).join("");
    const text  = `Quydly — Edition #${getEditionNumber()}\n${grade.emoji} ${grade.label} | ${score} pts\n${emoji}\nBeaten ${beatenPct}% of readers today`;

    // Fallback that works on http://localhost and all browsers
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "absolute";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (<>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        {/* Grade */}
        <Text style={styles.gradeEmoji}>{grade.emoji}</Text>
        <Text style={styles.gradeLabel}>{grade.label}</Text>
        <Text style={styles.gradeScore}>{score} points · {correct}/5 correct</Text>

        {/* Rank */}
        <View style={styles.rankBox}>
          <Text style={styles.rankVal}>Top {topPct}%</Text>
          <Text style={styles.rankLbl}>You beat {beatenPct}% of readers today</Text>
        </View>

        {/* Mix breakdown */}
        <Text style={styles.sectionLabel}>Today's Mix</Text>
        <View style={{ marginBottom: scale * 20 }}>
          {Object.entries(mix).map(([id, count]) => {
            const cat = CATEGORIES.find((c) => c.id === id);
            return (
              <View key={id} style={styles.mixRow}>
                <Text style={styles.mixRowLabel}>{cat.emoji} {cat.label}</Text>
                <MixBar pct={count / total} styles={styles} />
                <Text style={styles.mixRowCount}>{count}</Text>
              </View>
            );
          })}
        </View>

        {/* Strategy hint */}
        {FLAGS.showStrategyHint && (
          <View style={styles.strategyHint}>
            <Text style={styles.strategyHintText}>
              Want to tune your mix?{" "}
              <Text style={styles.strategyHintAccent}>My Beat</Text>
              {" "}is coming in Premium.
            </Text>
          </View>
        )}

        {/* Streak note */}
        {streak > 1 && (
          <Text style={styles.streakNote}>🔥 {streak} day streak — keep it going!</Text>
        )}

        {/* Buttons */}
        <TouchableOpacity style={copied ? styles.shareBtnCopied : styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
          <Text style={styles.shareBtnText}>{copied ? "Copied! ✓" : "Share My Score →"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.playAgainBtn} onPress={onPlayAgain} activeOpacity={0.7}>
          <Text style={styles.playAgainBtnText}>↺ Play more?</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>

    <SaveStreakModal
      visible={!!promptSaveStreak}
      streak={streak}
      supabase={supabase}
      onSuccess={onStreakSaved}
      onDismiss={onStreakSaved}
      onBeforeOAuth={onBeforeOAuth}
    />
  </>);
}
