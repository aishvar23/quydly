import { useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Animated,
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

const LETTERS = ["A", "B", "C", "D"];
const WAGERS  = [10, 25, 50, 100];

// ── ProgressBar ───────────────────────────────────────────────────────────────
function ProgressBar({ current, total, label }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: current / total,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [current]);

  const widthInterpolated = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

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
function QuestionCard({ question, onAnswer, answered, selectedIndex, wager, setWager }) {
  const cat = CATEGORIES.find((c) => c.id === question.categoryId) || CATEGORIES[0];

  // Entry animation
  const slideAnim  = useRef(new Animated.Value(24)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim  = useRef(new Animated.Value(0.96)).current;

  // Answer animation
  const shakeAnim  = useRef(new Animated.Value(0)).current;
  const popAnim    = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Card slide-up entry
    Animated.parallel([
      Animated.timing(slideAnim,   { toValue: 0,   duration: 450, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1,   duration: 450, useNativeDriver: true }),
      Animated.timing(scaleAnim,   { toValue: 1,   duration: 450, useNativeDriver: true }),
    ]).start();
  }, [question]);

  const handleAnswer = (i) => {
    if (i === question.correctIndex) {
      // Pop
      Animated.sequence([
        Animated.timing(popAnim, { toValue: 1.04, duration: 150, useNativeDriver: true }),
        Animated.timing(popAnim, { toValue: 1,    duration: 150, useNativeDriver: true }),
      ]).start();
    } else {
      // Shake
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: -8, duration: 80,  useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue:  8, duration: 80,  useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -5, duration: 80,  useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue:  5, duration: 80,  useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue:  0, duration: 80,  useNativeDriver: true }),
      ]).start();
    }
    onAnswer(i);
  };

  const delta = answered
    ? selectedIndex === question.correctIndex
      ? `+${wager}`
      : `-${Math.floor(wager / 2)}`
    : null;
  const isGain = answered && selectedIndex === question.correctIndex;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity:   opacityAnim,
          transform: [
            { translateY: slideAnim },
            { scale: scaleAnim },
            { translateX: shakeAnim },
          ],
        },
      ]}
    >
      {/* Topic tag */}
      <View style={styles.topicTag}>
        <Text style={styles.topicTagText}>{cat.emoji} {cat.label}</Text>
      </View>

      {/* Question */}
      <Text style={styles.questionText}>{question.question}</Text>

      {/* Wager — hidden after answering */}
      {!answered && (
        <>
          <Text style={styles.sectionLabel}>Your Wager</Text>
          <View style={styles.wagerRow}>
            {WAGERS.map((w) => (
              <TouchableOpacity
                key={w}
                style={[styles.wagerBtn, wager === w && styles.wagerBtnActive]}
                onPress={() => setWager(w)}
                activeOpacity={0.7}
              >
                <Text style={[styles.wagerBtnText, wager === w && styles.wagerBtnTextActive]}>
                  {w} pts
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Answers */}
      <View style={styles.answers}>
        {question.options.map((opt, i) => {
          let btnStyle  = styles.answerBtn;
          let letStyle  = styles.answerLetter;
          let textStyle = styles.answerText;
          let opacity   = 1;

          if (answered) {
            if (i === question.correctIndex) {
              btnStyle  = [styles.answerBtn, styles.answerCorrect];
              letStyle  = [styles.answerLetter, styles.answerLetterCorrect];
              textStyle = [styles.answerText,   styles.answerTextRevealed];
            } else if (i === selectedIndex) {
              btnStyle  = [styles.answerBtn, styles.answerWrong];
              letStyle  = [styles.answerLetter, styles.answerLetterWrong];
              textStyle = [styles.answerText,   styles.answerTextRevealed];
            } else {
              opacity = 0.35;
            }
          }

          return (
            <Animated.View key={i} style={[{ opacity }, answered && i === question.correctIndex ? { transform: [{ scale: popAnim }] } : {}]}>
              <TouchableOpacity
                style={btnStyle}
                onPress={() => !answered && handleAnswer(i)}
                disabled={answered}
                activeOpacity={0.7}
              >
                <View style={letStyle}>
                  <Text style={styles.answerLetterText}>{LETTERS[i]}</Text>
                </View>
                <Text style={textStyle}>{opt}</Text>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>

      {/* Post-answer: points flash + TL;DR */}
      {answered && (
        <>
          <Text style={[styles.pointsFlash, isGain ? styles.pointsGain : styles.pointsLoss]}>
            {delta} pts
          </Text>
          <View style={styles.revealPanel}>
            <Text style={styles.revealLabel}>📰 TL;DR</Text>
            <Text style={styles.revealText}>{question.tldr}</Text>
          </View>
        </>
      )}
    </Animated.View>
  );
}

// ── QuestionScreen ────────────────────────────────────────────────────────────
// Props:
//   question      — { question, options, correctIndex, tldr, categoryId }
//   onAnswer      — (index: number) => void
//   onNext        — () => void
//   answered      — boolean
//   selectedIndex — number | null
//   wager         — number
//   setWager      — (number) => void
//   currentQ      — number (0-based)
//   strategyLabel — string  (e.g. "Today's Edition")
export default function QuestionScreen({
  question,
  onAnswer,
  onNext,
  answered,
  selectedIndex,
  wager,
  setWager,
  currentQ,
  strategyLabel,
}) {
  const total = FLAGS.freeQuestionsPerDay;
  const isLast = currentQ + 1 >= total;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ProgressBar
        current={currentQ + (answered ? 1 : 0)}
        total={total}
        label={strategyLabel}
      />

      <QuestionCard
        question={question}
        onAnswer={onAnswer}
        answered={answered}
        selectedIndex={selectedIndex}
        wager={wager}
        setWager={setWager}
      />

      {answered && (
        <TouchableOpacity style={styles.nextBtn} onPress={onNext} activeOpacity={0.85}>
          <Text style={styles.nextBtnText}>
            {isLast ? "See Results →" : "Next Question →"}
          </Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.ink },
  content: {
    maxWidth: 480,
    alignSelf: "center",
    width: "100%",
    paddingHorizontal: 20,
    paddingBottom: 80,
  },

  // ProgressBar
  progressWrap: { marginBottom: 22 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  progressLabel: { fontFamily: FONT.monoReg, fontSize: 11, color: T.muted, letterSpacing: 0.5 },
  progressTrack: { height: 3, backgroundColor: T.card2, borderRadius: 3, overflow: "hidden" },
  progressFill:  { height: "100%", backgroundColor: T.amber, borderRadius: 3 },

  // Card
  card: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    padding: 24,
  },

  // Topic tag
  topicTag: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(232,160,32,0.10)",
    borderWidth: 1,
    borderColor: "rgba(232,160,32,0.25)",
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: 16,
  },
  topicTagText: {
    fontFamily: FONT.mono,
    fontSize: 10,
    fontWeight: "700",
    color: T.amber,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },

  // Question
  questionText: {
    fontFamily: FONT.display,
    fontSize: 19,
    fontWeight: "700",
    lineHeight: 28,
    color: T.cream,
    marginBottom: 24,
  },

  // Wager
  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: T.muted,
    fontWeight: "700",
    marginBottom: 10,
  },
  wagerRow: { flexDirection: "row", gap: 7, marginBottom: 22 },
  wagerBtn: {
    flex: 1,
    paddingVertical: 9,
    backgroundColor: T.card2,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 8,
    alignItems: "center",
  },
  wagerBtnActive: {
    backgroundColor: "rgba(232,160,32,0.12)",
    borderColor: T.amber,
  },
  wagerBtnText: {
    fontFamily: FONT.mono,
    fontSize: 12,
    fontWeight: "700",
    color: T.muted,
  },
  wagerBtnTextActive: { color: T.amber2 },

  // Answers
  answers: { gap: 9 },
  answerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: T.card2,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 11,
  },
  answerCorrect: {
    backgroundColor: "rgba(58,170,114,0.12)",
    borderColor: T.green,
  },
  answerWrong: {
    backgroundColor: "rgba(217,64,64,0.10)",
    borderColor: T.red,
  },
  answerLetter: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: "center",
    justifyContent: "center",
  },
  answerLetterCorrect: { backgroundColor: T.green, borderColor: T.green },
  answerLetterWrong:   { backgroundColor: T.red,   borderColor: T.red   },
  answerLetterText: {
    fontFamily: FONT.mono,
    fontSize: 11,
    fontWeight: "700",
    color: T.muted,
  },
  answerText: {
    flex: 1,
    fontFamily: FONT.body,
    fontSize: 14,
    color: T.cream2,
    lineHeight: 20,
  },
  answerTextRevealed: { color: T.cream, fontWeight: "700" },

  // Points flash
  pointsFlash: {
    textAlign: "center",
    fontFamily: FONT.mono,
    fontSize: 26,
    fontWeight: "700",
    marginTop: 14,
    marginBottom: 4,
  },
  pointsGain: { color: T.green },
  pointsLoss: { color: T.red   },

  // TL;DR reveal
  revealPanel: {
    marginTop: 18,
    padding: 16,
    backgroundColor: T.card2,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: T.amber,
  },
  revealLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: T.amber,
    marginBottom: 7,
  },
  revealText: {
    fontFamily: FONT.body,
    fontSize: 13,
    lineHeight: 21,
    color: T.cream2,
    fontWeight: "300",
  },

  // Next button
  nextBtn: {
    width: "100%",
    marginTop: 18,
    paddingVertical: 14,
    backgroundColor: T.amber,
    borderRadius: 11,
    alignItems: "center",
  },
  nextBtnText: {
    fontFamily: FONT.mono,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: T.ink,
  },
});
