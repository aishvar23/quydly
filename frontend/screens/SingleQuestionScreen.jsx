import { useState, useEffect, useMemo } from "react";
import { View, Text, TouchableOpacity, ScrollView, useWindowDimensions } from "react-native";
import QuestionScreen from "./QuestionScreen";

// ── Tokens (mirror QuestionScreen / GateScreen) ────────────────────────────────
const T = {
  ink:     "#0c0b09",
  card:    "#1c1a17",
  card2:   "#242118",
  cream:   "#f2ead8",
  cream2:  "#c8bfa8",
  amber:   "#e8a020",
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

function makeStyles(scale) {
  const s = (v) => v * scale;
  return {
    container: { flex: 1, backgroundColor: T.ink },
    content:   { flexGrow: 1, maxWidth: MAX_WIDTH, alignSelf: "center", width: "100%", paddingHorizontal: s(20), paddingTop: s(16), paddingBottom: s(24) },

    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: s(8) },
    loadingText: { fontFamily: FONT.mono, fontSize: s(13), color: T.amber, letterSpacing: s(1), textTransform: "uppercase" },
    loadingSub:  { fontFamily: FONT.monoReg, fontSize: s(11), color: T.muted },

    masthead:    { alignItems: "center", marginBottom: s(14) },
    brand:       { fontFamily: FONT.display, fontSize: s(22), fontWeight: "900", color: T.cream, letterSpacing: s(1) },
    kicker:      { fontFamily: FONT.monoReg, fontSize: s(10), color: T.muted, letterSpacing: s(1.5), textTransform: "uppercase", marginTop: s(2) },

    card:        { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: s(16), paddingVertical: s(28), paddingHorizontal: s(22), alignItems: "center" },
    icon:        { fontSize: s(40), marginBottom: s(12) },
    title:       { fontFamily: FONT.display, fontSize: s(20), fontWeight: "900", color: T.cream, marginBottom: s(8), textAlign: "center" },
    sub:         { fontFamily: FONT.body, fontSize: s(13), color: T.cream2, fontWeight: "300", lineHeight: s(20), textAlign: "center", marginBottom: s(22) },

    primaryBtn:     { width: "100%", paddingVertical: s(14), backgroundColor: T.amber, borderRadius: s(11), alignItems: "center", marginBottom: s(10) },
    primaryBtnText: { fontFamily: FONT.mono, fontSize: s(13), fontWeight: "700", letterSpacing: s(0.5), color: T.ink },

    secondaryBtn:     { width: "100%", paddingVertical: s(13), backgroundColor: "transparent", borderWidth: 1, borderColor: T.border2, borderRadius: s(11), alignItems: "center" },
    secondaryBtnText: { fontFamily: FONT.mono, fontSize: s(12), fontWeight: "700", color: T.cream2, letterSpacing: s(0.5) },
  };
}

// ── SingleQuestionScreen ────────────────────────────────────────────────────────
// Public, shareable single-question page behind quydly.com/question/<id>.
// Loads ONE question (the one tweeted to X) and runs the exact same quiz card the
// daily game uses, then funnels the visitor to play the full quiz and sign in.
//
// Props:
//   questionId — the social_questions uuid from the URL
//   apiBase    — backend base URL
//   isSignedIn — whether a non-anonymous session exists
//   onPlayFull — () => void   navigate to the full daily quiz
//   onSignIn   — () => void   open the sign-in modal
export default function SingleQuestionScreen({ questionId, apiBase, isSignedIn, onPlayFull, onSignIn }) {
  const { width } = useWindowDimensions();
  const scale  = Math.min(Math.min(width, MAX_WIDTH) / BASE_WIDTH, 1.0);
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const [status,      setStatus]      = useState("loading"); // loading | ready | error
  const [question,    setQuestion]    = useState(null);
  const [answered,    setAnswered]    = useState(false);
  const [skipped,     setSkipped]     = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [wager,       setWager]       = useState(25);
  const [showCta,     setShowCta]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/questions/${questionId}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (!cancelled) { setQuestion(data); setStatus("ready"); }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [questionId, apiBase]);

  // Local scoring only — this page never submits a completion (it isn't a daily
  // session). Points are ephemeral so the experience matches the real card.
  const handleAnswer = (idx) => { setSelectedIdx(idx); setSkipped(false); setAnswered(true); };
  const handleSkip   = () => { setSelectedIdx(null); setSkipped(true); setAnswered(true); };

  if (status === "loading") {
    return (
      <View style={styles.loadingWrap}>
        <Text style={styles.loadingText}>Loading question…</Text>
        <Text style={styles.loadingSub}>One from today's edition</Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Masthead styles={styles} />
        <View style={styles.card}>
          <Text style={styles.icon}>🗞️</Text>
          <Text style={styles.title}>This question isn't available.</Text>
          <Text style={styles.sub}>It may have expired. Today's full quiz is fresh and waiting.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onPlayFull} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Play today's quiz →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Post-answer call-to-action: play more + sign in (same funnel as the app).
  if (showCta) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Masthead styles={styles} />
        <View style={styles.card}>
          <Text style={styles.icon}>🔥</Text>
          <Text style={styles.title}>Nice. Want the full edition?</Text>
          <Text style={styles.sub}>
            That was one of today's 5. Play the rest in ~3 minutes, then come back daily to build your streak.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onPlayFull} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Play today's full quiz →</Text>
          </TouchableOpacity>
          {!isSignedIn && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={onSignIn} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>Sign in to save your streak</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <QuestionScreen
        question={question}
        onAnswer={handleAnswer}
        onNext={() => setShowCta(true)}
        onSkip={handleSkip}
        onQuit={onPlayFull}
        answered={answered}
        skipped={skipped}
        selectedIndex={selectedIdx}
        wager={wager}
        setWager={setWager}
        currentQ={0}
        totalQ={1}
        unlimited={false}
        strategyLabel="Today's Quiz"
        nextLabel="Continue →"
      />
    </View>
  );
}

function Masthead({ styles }) {
  return (
    <View style={styles.masthead}>
      <Text style={styles.brand}>QUYDLY</Text>
      <Text style={styles.kicker}>The Daily News Quiz</Text>
    </View>
  );
}
