import { useEffect, useRef, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView,
  Animated, useWindowDimensions,
} from "react-native";
import { CATEGORIES } from "../../config/categories";
import FLAGS from "../../config/flags";

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
  red:     "#d94040",
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

const LETTERS   = ["A", "B", "C", "D"];
const WAGERS    = [10, 25, 50, 100];
const MAX_WIDTH  = 900;
const BASE_WIDTH = 390;

// ── Scaled styles ─────────────────────────────────────────────────────────────
function makeStyles(scale) {
  const s = (v) => v * scale;
  return {
    container: { flex: 1, backgroundColor: T.ink },
    content:   { flexGrow: 1, maxWidth: MAX_WIDTH, alignSelf: "center", width: "100%", paddingHorizontal: s(16), paddingTop: s(16), paddingBottom: s(24) },

    // ProgressBar
    progressWrap:   { marginBottom: s(14) },
    progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: s(6) },
    progressLabel:  { fontFamily: FONT.monoReg, fontSize: s(11), color: T.muted, letterSpacing: s(0.5) },
    progressTrack:  { height: s(3), backgroundColor: T.card2, borderRadius: s(3), overflow: "hidden" },
    progressFill:   { height: "100%", backgroundColor: T.amber, borderRadius: s(3) },

    // Card
    card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: s(16), padding: s(18) },

    // Topic tag
    topicTag:     { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", backgroundColor: "rgba(232,160,32,0.10)", borderWidth: 1, borderColor: "rgba(232,160,32,0.25)", borderRadius: s(20), paddingVertical: s(4), paddingHorizontal: s(10), marginBottom: s(12) },
    topicTagText: { fontFamily: FONT.mono, fontSize: s(10), fontWeight: "700", color: T.amber, letterSpacing: s(0.5), textTransform: "uppercase" },

    // Question
    questionText: { fontFamily: FONT.display, fontSize: s(17), fontWeight: "700", lineHeight: s(25), color: T.cream, marginBottom: s(16) },

    // Wager
    sectionLabel:      { fontFamily: FONT.mono, fontSize: s(9), textTransform: "uppercase", letterSpacing: s(1.5), color: T.muted, fontWeight: "700", marginBottom: s(8) },
    wagerRow:          { flexDirection: "row", gap: s(6), marginBottom: s(14) },
    wagerBtn:          { flex: 1, paddingVertical: s(8), backgroundColor: T.card2, borderWidth: 1, borderColor: T.border, borderRadius: s(8), alignItems: "center" },
    wagerBtnActive:    { backgroundColor: "rgba(232,160,32,0.12)", borderColor: T.amber },
    wagerBtnText:      { fontFamily: FONT.mono, fontSize: s(11), fontWeight: "700", color: T.muted },
    wagerBtnTextActive:{ color: T.amber2 },

    // Answers
    answers:             { gap: s(8) },
    answerBtn:           { flexDirection: "row", alignItems: "center", gap: s(10), paddingVertical: s(11), paddingHorizontal: s(14), backgroundColor: T.card2, borderWidth: 1, borderColor: T.border, borderRadius: s(11) },
    answerCorrect:       { backgroundColor: "rgba(58,170,114,0.12)", borderColor: T.green },
    answerWrong:         { backgroundColor: "rgba(217,64,64,0.10)",  borderColor: T.red  },
    answerLetter:        { width: s(24), height: s(24), borderRadius: s(6), backgroundColor: T.card, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" },
    answerLetterCorrect: { backgroundColor: T.green, borderColor: T.green },
    answerLetterWrong:   { backgroundColor: T.red,   borderColor: T.red   },
    answerLetterText:    { fontFamily: FONT.mono, fontSize: s(11), fontWeight: "700", color: T.muted },
    answerText:          { flex: 1, fontFamily: FONT.body, fontSize: s(14), color: T.cream2, lineHeight: s(20) },
    answerTextRevealed:  { color: T.cream, fontWeight: "700" },

    // Points flash + reveal
    pointsFlash:  { textAlign: "center", fontFamily: FONT.mono, fontSize: s(24), fontWeight: "700", marginTop: s(12), marginBottom: s(4) },
    pointsGain:   { color: T.green },
    pointsLoss:   { color: T.red   },
    revealPanel:  { marginTop: s(14), padding: s(14), backgroundColor: T.card2, borderRadius: s(10), borderLeftWidth: 3, borderLeftColor: T.amber },
    revealLabel:  { fontFamily: FONT.mono, fontSize: s(9),  fontWeight: "700", textTransform: "uppercase", letterSpacing: s(1.5), color: T.amber, marginBottom: s(6) },
    revealText:   { fontFamily: FONT.body, fontSize: s(13), lineHeight: s(20), color: T.cream2, fontWeight: "300" },

    // Next button
    nextBtn:     { width: "100%", marginTop: s(14), paddingVertical: s(13), backgroundColor: T.amber, borderRadius: s(11), alignItems: "center" },
    nextBtnText: { fontFamily: FONT.mono, fontSize: s(13), fontWeight: "700", letterSpacing: s(0.5), color: T.ink },
  };
}

// ── ProgressBar ───────────────────────────────────────────────────────────────
function ProgressBar({ current, total, label, styles }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: current / total, duration: 700, useNativeDriver: false }).start();
  }, [current]);

  const widthInterpolated = anim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressLabel}>{current} / {total}</Text>
      </View>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: widthInterpolated }]} />
      </View>
    </View>
  );
}

// ── QuestionCard ──────────────────────────────────────────────────────────────
function QuestionCard({ question, onAnswer, answered, selectedIndex, wager, setWager, styles }) {
  const cat = CATEGORIES.find((c) => c.id === question.categoryId) || CATEGORIES[0];

  // Shuffle options once per question, keeping correctIndex in sync
  const { shuffledOptions, shuffledCorrectIndex, indexMap } = useMemo(() => {
    const indices = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    return {
      shuffledOptions:      indices.map((i) => question.options[i]),
      shuffledCorrectIndex: indices.indexOf(question.correctIndex),
      indexMap:             indices, // shuffledPos → originalIndex
    };
  }, [question]);

  const slideAnim   = useRef(new Animated.Value(24)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim   = useRef(new Animated.Value(0.96)).current;
  const shakeAnim   = useRef(new Animated.Value(0)).current;
  const popAnim     = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim,   { toValue: 0, duration: 450, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(scaleAnim,   { toValue: 1, duration: 450, useNativeDriver: true }),
    ]).start();
  }, [question]);

  // selectedIndex from parent is the original (pre-shuffle) index; map to shuffled position for display
  const shuffledSelectedIndex = selectedIndex != null ? indexMap.indexOf(selectedIndex) : -1;

  const handleAnswer = (i) => {
    if (i === shuffledCorrectIndex) {
      Animated.sequence([
        Animated.timing(popAnim, { toValue: 1.04, duration: 150, useNativeDriver: true }),
        Animated.timing(popAnim, { toValue: 1,    duration: 150, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: -8, duration: 80, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue:  8, duration: 80, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -5, duration: 80, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue:  5, duration: 80, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue:  0, duration: 80, useNativeDriver: true }),
      ]).start();
    }
    onAnswer(indexMap[i]); // pass original index so App.jsx scoring stays correct
  };

  const delta  = answered ? (shuffledSelectedIndex === shuffledCorrectIndex ? `+${wager}` : `-${Math.floor(wager / 2)}`) : null;
  const isGain = answered && shuffledSelectedIndex === shuffledCorrectIndex;

  return (
    <Animated.View style={[styles.card, { opacity: opacityAnim, transform: [{ translateY: slideAnim }, { scale: scaleAnim }, { translateX: shakeAnim }] }]}>
      <View style={styles.topicTag}>
        <Text style={styles.topicTagText}>{cat.emoji} {cat.label}</Text>
      </View>

      <Text style={styles.questionText}>{question.question}</Text>

      {!answered && (
        <>
          <Text style={styles.sectionLabel}>Your Wager</Text>
          <View style={styles.wagerRow}>
            {WAGERS.map((w) => (
              <TouchableOpacity key={w} style={[styles.wagerBtn, wager === w && styles.wagerBtnActive]} onPress={() => setWager(w)} activeOpacity={0.7}>
                <Text style={[styles.wagerBtnText, wager === w && styles.wagerBtnTextActive]}>{w} pts</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <View style={styles.answers}>
        {shuffledOptions.map((opt, i) => {
          let btnStyle  = styles.answerBtn;
          let letStyle  = styles.answerLetter;
          let textStyle = styles.answerText;
          let opacity   = 1;

          if (answered) {
            if (i === shuffledCorrectIndex) {
              btnStyle  = [styles.answerBtn,  styles.answerCorrect];
              letStyle  = [styles.answerLetter, styles.answerLetterCorrect];
              textStyle = [styles.answerText,  styles.answerTextRevealed];
            } else if (i === shuffledSelectedIndex) {
              btnStyle  = [styles.answerBtn,  styles.answerWrong];
              letStyle  = [styles.answerLetter, styles.answerLetterWrong];
              textStyle = [styles.answerText,  styles.answerTextRevealed];
            } else {
              opacity = 0.35;
            }
          }

          return (
            <Animated.View key={i} style={[{ opacity }, answered && i === shuffledCorrectIndex ? { transform: [{ scale: popAnim }] } : {}]}>
              <TouchableOpacity style={btnStyle} onPress={() => !answered && handleAnswer(i)} disabled={answered} activeOpacity={0.7}>
                <View style={letStyle}>
                  <Text style={styles.answerLetterText}>{LETTERS[i]}</Text>
                </View>
                <Text style={textStyle}>{opt}</Text>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>

      {answered && (
        <>
          <Text style={[styles.pointsFlash, isGain ? styles.pointsGain : styles.pointsLoss]}>{delta} pts</Text>
          <View style={styles.revealPanel}>
            <Text style={styles.revealLabel}>📰 TL;DR</Text>
            <Text style={styles.revealText}>{question.tldr || question.insight_tldr || "No context available for this question."}</Text>
          </View>
        </>
      )}
    </Animated.View>
  );
}

// ── QuestionScreen ────────────────────────────────────────────────────────────
export default function QuestionScreen({ question, onAnswer, onNext, answered, selectedIndex, wager, setWager, currentQ, strategyLabel }) {
  const { width } = useWindowDimensions();
  const scale  = Math.min(Math.min(width, MAX_WIDTH) / BASE_WIDTH, 1.0);
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const total  = FLAGS.freeQuestionsPerDay;
  const isLast = currentQ + 1 >= total;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ProgressBar current={currentQ + (answered ? 1 : 0)} total={total} label={strategyLabel} styles={styles} />

      <QuestionCard
        question={question}
        onAnswer={onAnswer}
        answered={answered}
        selectedIndex={selectedIndex}
        wager={wager}
        setWager={setWager}
        styles={styles}
      />

      {answered && (
        <TouchableOpacity style={styles.nextBtn} onPress={onNext} activeOpacity={0.85}>
          <Text style={styles.nextBtnText}>{isLast ? "See Results →" : "Next Question →"}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}
