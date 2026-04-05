import { useMemo } from "react";
import { View, Text, TouchableOpacity, ScrollView, Image, useWindowDimensions } from "react-native";
import { CATEGORIES } from "../../config/categories";

// ── Tokens ────────────────────────────────────────────────────────────────────
const T = {
  ink:     "#0c0b09",
  ink2:    "#161512",
  card:    "#1c1a17",
  card2:   "#242118",
  cream:   "#f2ead8",
  cream2:  "#c8bfa8",
  amber:   "#e8a020",
  amber2:  "#f5b940",
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

const MAX_WIDTH = 900;
const BASE_WIDTH = 390;

// ── Helpers ───────────────────────────────────────────────────────────────────
function getEditionNumber() {
  return Math.floor((new Date() - new Date("2025-01-01")) / 86400000) + 1;
}

function formatDate() {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Scaled styles ─────────────────────────────────────────────────────────────
function makeStyles(scale) {
  const s = (v) => v * scale;
  return {
    container: { flex: 1, backgroundColor: T.ink },
    content:   { flexGrow: 1, maxWidth: MAX_WIDTH, alignSelf: "center", width: "100%", paddingHorizontal: s(20), paddingBottom: s(24) },

    // Masthead
    masthead:        { paddingTop: s(16), paddingBottom: s(12), borderBottomWidth: 1, borderBottomColor: T.border2, marginBottom: s(14), flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    mastheadEyebrow: { fontFamily: FONT.mono, fontSize: s(9), letterSpacing: s(2), textTransform: "uppercase", color: T.amber, marginBottom: s(4) },
    mastheadLogo:    { width: s(180), height: s(56), resizeMode: "contain" },
    mastheadTagline: { fontFamily: FONT.mono, fontSize: s(9), letterSpacing: s(1), textTransform: "uppercase", color: T.muted, marginTop: s(2) },
    streakBadge:         { backgroundColor: T.amber,  borderRadius: s(20), paddingHorizontal: s(11), paddingVertical: s(5) },
    streakBadgeText:     { fontFamily: FONT.mono,    fontSize: s(11), fontWeight: "700", color: T.ink },

    // StatsBar
    statsBar: { flexDirection: "row", gap: s(8), marginBottom: s(14) },
    statChip: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: s(10), paddingVertical: s(10), paddingHorizontal: s(8), alignItems: "center" },
    statVal:  { fontFamily: FONT.mono, fontSize: s(20), fontWeight: "700", color: T.amber, lineHeight: s(22) },
    statLbl:  { fontFamily: FONT.body, fontSize: s(9),  textTransform: "uppercase", letterSpacing: s(1), color: T.muted, marginTop: s(3), fontWeight: "600" },

    // HomeCard
    homeCard:     { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: s(16), paddingVertical: s(22), paddingHorizontal: s(20), alignItems: "center" },
    homeEdition:  { fontFamily: FONT.mono,    fontSize: s(10), fontWeight: "600", letterSpacing: s(2), textTransform: "uppercase", color: T.amber, marginBottom: s(8) },
    homeHeadline: { fontFamily: FONT.display,  fontSize: s(24), fontWeight: "900", lineHeight: s(30), color: T.cream, textAlign: "center", marginBottom: s(6) },
    homeSub:      { fontFamily: FONT.body,    fontSize: s(13), color: T.muted, fontWeight: "300", textAlign: "center", lineHeight: s(19), marginBottom: s(16) },

    // Mix pills
    mixPreview:  { flexDirection: "row", flexWrap: "wrap", gap: s(6), justifyContent: "center", marginBottom: s(16) },
    mixPill:     { backgroundColor: T.card2, borderWidth: 1, borderColor: T.border, borderRadius: s(20), paddingVertical: s(4), paddingHorizontal: s(10) },
    mixPillText: { fontFamily: FONT.body, fontSize: s(11), color: T.cream2 },

    // Start button
    startBtn:     { width: "100%", paddingVertical: s(14), backgroundColor: T.amber, borderRadius: s(12), alignItems: "center", marginBottom: s(10) },
    startBtnText: { fontFamily: FONT.mono, fontSize: s(13), fontWeight: "700", letterSpacing: s(0.5), color: T.ink },

    // Credits note
    creditsNote: { fontFamily: FONT.mono, fontSize: s(11), color: T.muted },
  };
}

// ── Masthead ──────────────────────────────────────────────────────────────────
const LOGO = require("../assets/logo.png");

function Masthead({ streak, styles }) {
  return (
    <View style={styles.masthead}>
      <View>
        <Text style={styles.mastheadEyebrow}>{formatDate()} · Edition #{getEditionNumber()}</Text>
        <Image source={LOGO} style={styles.mastheadLogo} />
        <Text style={styles.mastheadTagline}>The daily news game · kwid-lee</Text>
      </View>
      {streak > 0 && (
        <View style={styles.streakBadge}>
          <Text style={styles.streakBadgeText}>🔥 {streak} day{streak !== 1 ? "s" : ""}</Text>
        </View>
      )}
    </View>
  );
}

// ── StatsBar ──────────────────────────────────────────────────────────────────
function StatsBar({ points, credits, answered, styles }) {
  return (
    <View style={styles.statsBar}>
      {[
        { val: points,   lbl: "Points"     },
        { val: credits,  lbl: "Left Today" },
        { val: answered, lbl: "Answered"   },
      ].map(({ val, lbl }) => (
        <View key={lbl} style={styles.statChip}>
          <Text style={styles.statVal}>{val}</Text>
          <Text style={styles.statLbl}>{lbl}</Text>
        </View>
      ))}
    </View>
  );
}

// ── HomeScreen ────────────────────────────────────────────────────────────────
export default function HomeScreen({ onStart, credits, strategy, streak = 0, points = 0, answered = 0 }) {
  const { width } = useWindowDimensions();
  const scale  = Math.min(Math.min(width, MAX_WIDTH) / BASE_WIDTH, 1.0);
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const mix = strategy.getCategoryMix();
  const pills = [];
  Object.entries(mix).forEach(([id, count]) => {
    const cat = CATEGORIES.find((c) => c.id === id);
    for (let i = 0; i < count; i++) {
      pills.push(
        <View key={`${id}-${i}`} style={styles.mixPill}>
          <Text style={styles.mixPillText}>{cat.emoji} {cat.label}</Text>
        </View>
      );
    }
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Masthead streak={streak} styles={styles} />
      <StatsBar points={points} credits={credits} answered={answered} styles={styles} />

      <View style={styles.homeCard}>
        <Text style={styles.homeEdition}>Quydly · {strategy.getLabel()}</Text>
        <Text style={styles.homeHeadline}>{"5 Questions.\n3 Minutes.\nStay Sharp."}</Text>
        <Text style={styles.homeSub}>{"AI-curated from today's real headlines.\nWager points. Get smarter."}</Text>
        <View style={styles.mixPreview}>{pills}</View>
        <TouchableOpacity style={styles.startBtn} onPress={onStart} activeOpacity={0.85}>
          <Text style={styles.startBtnText}>Start Today's Edition →</Text>
        </TouchableOpacity>
        <Text style={styles.creditsNote}>
          {credits} question{credits !== 1 ? "s" : ""} remaining today
        </Text>
      </View>
    </ScrollView>
  );
}
