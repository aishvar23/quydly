import "react-native-url-polyfill/auto";
import { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, PlayfairDisplay_900Black } from "@expo-google-fonts/playfair-display";
import { JetBrainsMono_700Bold, JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono";
import { Lato_400Regular, Lato_300Light } from "@expo-google-fonts/lato";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

import HomeScreen from "./screens/HomeScreen";
import QuestionScreen from "./screens/QuestionScreen";
import { getActiveStrategy } from "./services/contentStrategy";
import FLAGS from "../config/flags";

SplashScreen.preventAutoHideAsync();

// ── Supabase client ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true } }
);

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  // Fonts
  const [fontsLoaded, fontError] = useFonts({
    "PlayfairDisplay-Black":  PlayfairDisplay_900Black,
    "JetBrainsMono-Bold":     JetBrainsMono_700Bold,
    "JetBrainsMono-Regular":  JetBrainsMono_400Regular,
    "Lato-Regular":           Lato_400Regular,
    "Lato-Light":             Lato_300Light,
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) await SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Auth
  const [session, setSession] = useState(null);

  // Quiz state
  const strategy = getActiveStrategy();
  const [screen, setScreen]           = useState("home");
  const [questions, setQuestions]     = useState([]);
  const [currentQ, setCurrentQ]       = useState(0);
  const [answered, setAnswered]       = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [wager, setWager]             = useState(25);
  const [points, setPoints]           = useState(0);
  const [streak, setStreak]           = useState(0);
  const [results, setResults]         = useState([]);
  const [credits, setCredits]         = useState(FLAGS.freeQuestionsPerDay);
  const [loadError, setLoadError]     = useState(null);

  // ── Auth init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session);
        loadUserData(session.user.id);
      } else {
        supabase.auth.signInAnonymously().then(({ data, error }) => {
          if (!error) setSession(data.session);
          // public.users row is auto-created by the on_auth_user_created DB trigger
        });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadUserData = async (userId) => {
    const { data } = await supabase
      .from("users")
      .select("streak, total_points")
      .eq("id", userId)
      .single();
    if (data) {
      setStreak(data.streak ?? 0);
      setPoints(data.total_points ?? 0);
    }
  };

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleStart = async () => {
    if (credits <= 0) {
      // TODO: navigate to GateScreen (next screen to build)
      return;
    }
    setLoadError(null);
    setScreen("loading");
    try {
      const res = await fetch(`${API_BASE}/api/questions`);
      if (!res.ok) throw new Error(`${res.status}`);
      const { questions: qs } = await res.json();
      setQuestions(qs);
      setCurrentQ(0);
      setAnswered(false);
      setSelectedIdx(null);
      setWager(25);
      setResults([]);
      setScreen("quiz");
    } catch (err) {
      setLoadError("Couldn't load today's questions. Check your connection and try again.");
      setScreen("home");
    }
  };

  const handleAnswer = (idx) => {
    const q = questions[currentQ];
    const correct = idx === q.correctIndex;
    const delta = correct ? wager : -Math.floor(wager / 2);
    setPoints((p) => p + delta);
    setCredits((c) => Math.max(0, c - 1));
    setSelectedIdx(idx);
    setAnswered(true);
    setResults((prev) => [...prev, { correct, delta, categoryId: q.categoryId }]);
  };

  const handleNext = async () => {
    const total = FLAGS.freeQuestionsPerDay;
    if (currentQ + 1 >= total) {
      // POST /api/complete with the session JWT
      if (session) {
        try {
          const sessionScore = results.reduce((acc, r) => acc + Math.max(0, r.delta), 0);
          const resp = await fetch(`${API_BASE}/api/complete`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ score: sessionScore, results }),
          });
          const data = await resp.json();
          if (data.streak !== undefined) setStreak(data.streak);
          if (data.totalPoints !== undefined) setPoints(data.totalPoints);
          // TODO: data.promptSaveStreak → show "Save your streak" modal (after Google OAuth is enabled)
          // TODO: navigate to EndScreen (next screen to build)
        } catch {
          // non-fatal — navigate on regardless
        }
      }
      setScreen("home"); // temporary until EndScreen is built
    } else {
      setCurrentQ((q) => q + 1);
      setAnswered(false);
      setSelectedIdx(null);
      setWager(25);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!fontsLoaded && !fontError) return null;

  return (
    <View style={styles.root} onLayout={onLayoutRootView}>
      <StatusBar style="light" backgroundColor="#0c0b09" />

      {screen === "loading" && (
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Scanning headlines...</Text>
          <Text style={styles.loadingSub}>Loading today's edition</Text>
        </View>
      )}

      {loadError && screen === "home" && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      )}

      {screen === "home" && (
        <HomeScreen
          onStart={handleStart}
          credits={credits}
          strategy={strategy}
          streak={streak}
          points={points}
          answered={results.length}
        />
      )}

      {screen === "quiz" && questions[currentQ] && (
        <QuestionScreen
          question={questions[currentQ]}
          onAnswer={handleAnswer}
          onNext={handleNext}
          answered={answered}
          selectedIndex={selectedIdx}
          wager={wager}
          setWager={setWager}
          currentQ={currentQ}
          strategyLabel={strategy.getLabel()}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0c0b09",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loadingText: {
    fontFamily: "JetBrainsMono-Bold",
    fontSize: 13,
    color: "#e8a020",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  loadingSub: {
    fontFamily: "JetBrainsMono-Regular",
    fontSize: 11,
    color: "#6b6455",
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    padding: 14,
    backgroundColor: "rgba(217,64,64,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,64,64,0.30)",
    borderRadius: 10,
  },
  errorText: {
    fontFamily: "Lato-Regular",
    fontSize: 13,
    color: "#d94040",
    lineHeight: 20,
  },
});
