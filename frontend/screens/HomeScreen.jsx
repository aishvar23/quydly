import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
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

// Fonts require expo-font to be loaded in App.jsx:
//   useFonts({ "PlayfairDisplay-Black": require("..."), "JetBrainsMono-Bold": require("..."), "Lato-Regular": require("...") })
const FONT = {
  display: "PlayfairDisplay-Black",
  mono:    "JetBrainsMono-Bold",
  monoReg: "JetBrainsMono-Regular",
  body:    "Lato-Regular",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getEditionNumber() {
  return Math.floor((new Date() - new Date("2025-01-01")) / 86400000) + 1;
}

function formatDate() {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Masthead ──────────────────────────────────────────────────────────────────
function Masthead({ streak }) {
  return (
    <View style={styles.masthead}>
      <View>
        <Text style={styles.mastheadEyebrow}>{formatDate()} · Edition #{getEditionNumber()}</Text>
        <Text style={styles.mastheadTitle}>
          <Text style={styles.mastheadTitleAccent}>Quydly</Text>
        </Text>
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
function StatsBar({ points, credits, answered }) {
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
// Props:
//   onStart   — () => void
//   credits   — number  (remaining plays today)
//   strategy  — ContentStrategy object (getLabel, getCategoryMix)
//   streak    — number
//   points    — number  (total_points from Supabase)
//   answered  — number  (questions answered this session so far)
export default function HomeScreen({ onStart, credits, strategy, streak = 0, points = 0, answered = 0 }) {
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Masthead streak={streak} />
      <StatsBar points={points} credits={credits} answered={answered} />

      <View style={styles.homeCard}>
        <Text style={styles.homeEdition}>Quydly · {strategy.getLabel()}</Text>

        <Text style={styles.homeHeadline}>
          {"5 Questions.\n3 Minutes.\nStay Sharp."}
        </Text>

        <Text style={styles.homeSub}>
          {"AI-curated from today's real headlines.\nWager points. Get smarter."}
        </Text>

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

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.ink,
  },
  content: {
    maxWidth: 480,
    alignSelf: "center",
    width: "100%",
    paddingHorizontal: 20,
    paddingBottom: 80,
  },

  // Masthead
  masthead: {
    paddingTop: 22,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.border2,
    marginBottom: 22,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  mastheadEyebrow: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: T.amber,
    marginBottom: 4,
  },
  mastheadTitle: {
    fontFamily: FONT.display,
    fontSize: 28,
    lineHeight: 28,
    letterSpacing: -0.5,
  },
  mastheadTitleAccent: {
    fontFamily: FONT.display,
    fontSize: 28,
    color: T.amber,
  },
  mastheadTagline: {
    fontFamily: FONT.mono,
    fontSize: 9,
    color: T.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  streakBadge: {
    backgroundColor: T.amber,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  streakBadgeText: {
    fontFamily: FONT.mono,
    fontSize: 11,
    fontWeight: "700",
    color: T.ink,
  },

  // StatsBar
  statsBar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 22,
  },
  statChip: {
    flex: 1,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  statVal: {
    fontFamily: FONT.mono,
    fontSize: 22,
    fontWeight: "700",
    color: T.amber,
    lineHeight: 24,
  },
  statLbl: {
    fontFamily: FONT.body,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: T.muted,
    marginTop: 4,
    fontWeight: "600",
  },

  // HomeCard
  homeCard: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  homeEdition: {
    fontFamily: FONT.mono,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
    color: T.amber,
    marginBottom: 10,
  },
  homeHeadline: {
    fontFamily: FONT.display,
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 33,
    color: T.cream,
    textAlign: "center",
    marginBottom: 8,
  },
  homeSub: {
    fontFamily: FONT.body,
    fontSize: 13,
    color: T.muted,
    fontWeight: "300",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },

  // Mix pills
  mixPreview: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    justifyContent: "center",
    marginBottom: 24,
  },
  mixPill: {
    backgroundColor: T.card2,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  mixPillText: {
    fontFamily: FONT.body,
    fontSize: 12,
    color: T.cream2,
  },

  // Start button
  startBtn: {
    width: "100%",
    paddingVertical: 16,
    backgroundColor: T.amber,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  startBtnText: {
    fontFamily: FONT.mono,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: T.ink,
  },

  // Credits note
  creditsNote: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: T.muted,
  },
});
