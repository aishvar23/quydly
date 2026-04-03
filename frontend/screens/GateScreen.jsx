import { useState, useEffect, useMemo } from "react";
import { View, Text, TouchableOpacity, ScrollView, useWindowDimensions } from "react-native";
import FLAGS from "../../config/flags";

// ── Tokens ────────────────────────────────────────────────────────────────────
const T = {
  ink:    "#0c0b09",
  card:   "#1c1a17",
  card2:  "#242118",
  cream:  "#f2ead8",
  cream2: "#c8bfa8",
  amber:  "#e8a020",
  muted:  "#6b6455",
  border:  "rgba(232,160,32,0.15)",
  border2: "rgba(232,160,32,0.30)",
};

const FONT = {
  display: "PlayfairDisplay-Black",
  mono:    "JetBrainsMono-Bold",
  body:    "Lato-Regular",
};

const MAX_WIDTH  = 900;
const BASE_WIDTH = 600;

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCountdown() {
  const now  = new Date();
  const next = new Date();
  next.setHours(7, 0, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);
  const d = next - now;
  return `${Math.floor(d / 3600000)}h ${Math.floor((d % 3600000) / 60000)}m`;
}

// ── Scaled styles ─────────────────────────────────────────────────────────────
function makeStyles(scale) {
  const s = (v) => v * scale;
  return {
    container: { flex: 1, backgroundColor: T.ink },
    content:   { maxWidth: MAX_WIDTH, alignSelf: "center", width: "100%", paddingHorizontal: s(20), paddingTop: s(22), paddingBottom: s(80) },

    card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: s(16), paddingVertical: s(32), paddingHorizontal: s(24), alignItems: "center" },

    gateIcon:  { fontSize: s(48), marginBottom: s(16) },
    gateTitle: { fontFamily: FONT.display, fontSize: s(24), fontWeight: "900", color: T.cream, marginBottom: s(8), textAlign: "center" },
    gateSub:   { fontFamily: FONT.body, fontSize: s(13), color: T.muted, fontWeight: "300", lineHeight: s(20), textAlign: "center", marginBottom: s(24) },

    countdown:    { fontFamily: FONT.mono, fontSize: s(32), fontWeight: "700", color: T.amber, marginBottom: s(6) },
    countdownLbl: { fontFamily: FONT.mono, fontSize: s(10), textTransform: "uppercase", letterSpacing: s(1.5), color: T.muted, marginBottom: s(24) },

    // Reset button (demo only)
    resetBtn:     { width: "100%", paddingVertical: s(14), backgroundColor: T.card2, borderWidth: 1, borderColor: T.border2, borderRadius: s(11), alignItems: "center", marginBottom: s(10) },
    resetBtnText: { fontFamily: FONT.mono, fontSize: s(12), fontWeight: "700", color: T.cream2, letterSpacing: s(0.5) },

    // Premium button — always rendered, disabled in pilot per SPEC.md
    premiumBtn:        { width: "100%", paddingVertical: s(14), backgroundColor: "transparent", borderWidth: 1, borderColor: T.border, borderRadius: s(11), alignItems: "center" },
    premiumBtnText:    { fontFamily: FONT.mono, fontSize: s(12), fontWeight: "700", color: T.muted, letterSpacing: s(0.5) },
    premiumBtnSub:     { fontFamily: FONT.mono, fontSize: s(9), color: T.amber, opacity: 0.7, letterSpacing: s(2), marginTop: s(2) },
  };
}

// ── GateScreen ────────────────────────────────────────────────────────────────
// Props:
//   onReset — () => void  (resets credits for demo)
export default function GateScreen({ onReset }) {
  const { width } = useWindowDimensions();
  const scale  = Math.min(width, MAX_WIDTH) / BASE_WIDTH;
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const [countdown, setCountdown] = useState(getCountdown());

  // Update countdown every minute
  useEffect(() => {
    const t = setInterval(() => setCountdown(getCountdown()), 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <Text style={styles.gateIcon}>🎉</Text>
        <Text style={styles.gateTitle}>You're all caught up.</Text>
        <Text style={styles.gateSub}>
          {"You've read today's full Daily Dose.\nCome back tomorrow for 5 fresh questions."}
        </Text>

        <Text style={styles.countdown}>{countdown}</Text>
        <Text style={styles.countdownLbl}>Until next edition drops</Text>

        {/* Reset — demo only */}
        <TouchableOpacity style={styles.resetBtn} onPress={onReset} activeOpacity={0.7}>
          <Text style={styles.resetBtnText}>↺ Reset for demo</Text>
        </TouchableOpacity>

        {/* Premium button — always rendered, disabled in pilot per SPEC.md
            In v2: flip FLAGS.premiumEnabled = true → wire to Stripe checkout */}
        <TouchableOpacity
          style={styles.premiumBtn}
          disabled={!FLAGS.premiumEnabled}
          activeOpacity={FLAGS.premiumEnabled ? 0.85 : 1}
        >
          <Text style={styles.premiumBtnText}>🔓 Go Premium — 10 questions/day</Text>
          {!FLAGS.premiumEnabled && (
            <Text style={styles.premiumBtnSub}>COMING SOON</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
