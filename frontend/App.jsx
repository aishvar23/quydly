import "react-native-url-polyfill/auto";
import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts, PlayfairDisplay_900Black } from "@expo-google-fonts/playfair-display";
import { JetBrainsMono_700Bold, JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono";
import { Lato_400Regular, Lato_300Light } from "@expo-google-fonts/lato";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

import SaveStreakModal from "./components/SaveStreakModal";
import HomeScreen from "./screens/HomeScreen";
import QuestionScreen from "./screens/QuestionScreen";
import EndScreen from "./screens/EndScreen";
import GateScreen from "./screens/GateScreen";
import { getActiveStrategy } from "./services/contentStrategy";
import FLAGS from "../config/flags";

// ── Supabase client ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  Platform.OS === "web"
    ? {}
    : { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true } }
);

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

// ── UserBar ───────────────────────────────────────────────────────────────────
// Extensible top-right user area. Add preference/settings buttons here in v2.
function UserBar({ session, onLogin, onLogout }) {
  if (!session) return null;
  const isAnon = session.user?.is_anonymous ?? true;
  const TOP = Platform.OS === "ios" ? 44 : Platform.OS === "android" ? 28 : 10;

  if (isAnon) {
    return (
      <TouchableOpacity
        onPress={onLogin}
        activeOpacity={0.8}
        style={{
          position: "absolute", top: TOP, right: 14, zIndex: 100,
          paddingVertical: 6, paddingHorizontal: 12,
          borderWidth: 1, borderColor: "rgba(232,160,32,0.35)",
          borderRadius: 20, backgroundColor: "rgba(12,11,9,0.6)",
        }}
      >
        <Text style={{ fontFamily: "JetBrainsMono-Bold", fontSize: 11, color: "#e8a020", letterSpacing: 0.5 }}>
          Sign In
        </Text>
      </TouchableOpacity>
    );
  }

  const firstName =
    session.user?.user_metadata?.full_name?.split(" ")[0] ??
    session.user?.user_metadata?.name?.split(" ")[0] ??
    session.user?.email?.split("@")[0] ??
    "there";

  return (
    <View style={{
      position: "absolute", top: TOP, right: 14, zIndex: 100,
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: "rgba(12,11,9,0.6)", borderRadius: 20,
      paddingVertical: 6, paddingHorizontal: 12,
      borderWidth: 1, borderColor: "rgba(232,160,32,0.20)",
    }}>
      <Text style={{ fontFamily: "JetBrainsMono-Regular", fontSize: 11, color: "#c8bfa8" }}>
        Hi, {firstName}
      </Text>
      <TouchableOpacity onPress={onLogout} activeOpacity={0.7}>
        <Text style={{ fontFamily: "JetBrainsMono-Bold", fontSize: 11, color: "#6b6455" }}>
          Sign Out
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── AuthBanner ────────────────────────────────────────────────────────────────
function AuthBanner({ name }) {
  const TOP = Platform.OS === "ios" ? 44 : Platform.OS === "android" ? 28 : 0;
  return (
    <View style={{
      position: "absolute", top: TOP, left: 0, right: 0, zIndex: 200,
      backgroundColor: "#3aaa72", paddingVertical: 10, alignItems: "center",
    }}>
      <Text style={{ fontFamily: "JetBrainsMono-Bold", fontSize: 12, color: "#0c0b09", letterSpacing: 0.5 }}>
        ✓ Signed in as {name}
      </Text>
    </View>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [fontsLoaded] = useFonts({
    "PlayfairDisplay-Black": PlayfairDisplay_900Black,
    "JetBrainsMono-Bold":    JetBrainsMono_700Bold,
    "JetBrainsMono-Regular": JetBrainsMono_400Regular,
    "Lato-Regular":          Lato_400Regular,
    "Lato-Light":            Lato_300Light,
  });

  const strategy = getActiveStrategy();

  const [session,         setSession]         = useState(null);
  const [screen,          setScreen]          = useState("home");
  const [questions,       setQuestions]       = useState([]);
  const [currentQ,        setCurrentQ]        = useState(0);
  const [questionOffset,  setQuestionOffset]  = useState(0);
  const [answered,    setAnswered]    = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [wager,       setWager]       = useState(25);
  const [points,      setPoints]      = useState(0);
  const [streak,      setStreak]      = useState(0);
  const [results,     setResults]     = useState([]);
  const [credits,     setCredits]     = useState(FLAGS.freeQuestionsPerDay);
  const [loadError,        setLoadError]        = useState(null);
  const [endRank,          setEndRank]          = useState(null);
  const [promptSaveStreak, setPromptSaveStreak] = useState(false);
  const [pendingPlayAgain, setPendingPlayAgain] = useState(false);
  const [showLoginModal,   setShowLoginModal]   = useState(false);
  const [authBanner,       setAuthBanner]       = useState(null); // first name string

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // If this is an OAuth redirect (hash contains access_token), skip the
    // anonymous sign-in — onAuthStateChange will fire with the real session.
    const isOAuthRedirect =
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      window.location.hash.includes("access_token");

    // Restore quiz state saved before the OAuth redirect
    if (isOAuthRedirect && typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem("quydly_oauth_resume");
      if (raw) {
        try {
          const { screen: s, results: r, endRank: er, pendingPlayAgain: ppa } = JSON.parse(raw);
          sessionStorage.removeItem("quydly_oauth_resume");
          if (s) setScreen(s);
          if (Array.isArray(r) && r.length) setResults(r);
          if (er != null) setEndRank(er);
          if (ppa) setPendingPlayAgain(true);
        } catch {}
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session);
        loadUserData(session.user.id);
      } else if (!isOAuthRedirect) {
        supabase.auth.signInAnonymously().then(({ data, error }) => {
          if (!error) setSession(data.session);
        });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (s && !s.user.is_anonymous) {
        loadUserData(s.user.id);
        // Clean the OAuth hash from the URL so it doesn't persist on refresh
        if (Platform.OS === "web" && typeof window !== "undefined" && window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        // Show a brief "signed in" confirmation banner
        if (event === "SIGNED_IN") {
          const firstName =
            s.user.user_metadata?.full_name?.split(" ")[0] ??
            s.user.user_metadata?.name?.split(" ")[0] ??
            s.user.email?.split("@")[0] ??
            "there";
          setAuthBanner(firstName);
          setTimeout(() => setAuthBanner(null), 3000);
          setShowLoginModal(false);
        }
        // If the user signed in via the "play again" prompt, navigate home now
        setPendingPlayAgain((ppa) => {
          if (ppa) {
            setScreen("home"); setResults([]); setEndRank(null);
            return false;
          }
          return ppa;
        });
      }
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    const { data } = await supabase.auth.signInAnonymously();
    if (data?.session) setSession(data.session);
    setStreak(0);
    setPoints(0);
  };

  const handleBeforeOAuth = () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("quydly_oauth_resume", JSON.stringify({
        screen, results, endRank, pendingPlayAgain,
      }));
    }
  };

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleStart = async (offset = 0, skipCreditCheck = false) => {
    if (!skipCreditCheck && credits <= 0) { setScreen("gate"); return; }
    setLoadError(null);
    setScreen("loading");
    try {
      const res = await fetch(`${API_BASE}/api/questions?offset=${offset}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const { questions: qs } = await res.json();
      setQuestions(qs);
      setQuestionOffset(offset);
      setCredits(FLAGS.freeQuestionsPerDay);
      setCurrentQ(0);
      setAnswered(false);
      setSelectedIdx(null);
      setWager(25);
      setResults([]);
      setScreen("quiz");
    } catch {
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
          if (data.rank !== undefined) setEndRank(data.rank);
          if (data.promptSaveStreak) setPromptSaveStreak(true);
        } catch {
          // non-fatal
        }
      }
      setScreen("end");
    } else {
      setCurrentQ((q) => q + 1);
      setAnswered(false);
      setSelectedIdx(null);
      setWager(25);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar style="light" backgroundColor="#0c0b09" />

      <UserBar
        session={session}
        onLogin={() => setShowLoginModal(true)}
        onLogout={handleLogout}
      />

      {authBanner && <AuthBanner name={authBanner} />}

      <SaveStreakModal
        visible={showLoginModal}
        streak={streak}
        supabase={supabase}
        mode="login"
        onSuccess={() => setShowLoginModal(false)}
        onDismiss={() => setShowLoginModal(false)}
        onBeforeOAuth={handleBeforeOAuth}
      />

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
          onStart={() => handleStart(0)}
          credits={credits}
          strategy={strategy}
          streak={streak}
          points={points}
          answered={results.length}
        />
      )}

      {screen === "gate" && (
        <GateScreen
          onReset={() => { setCredits(FLAGS.freeQuestionsPerDay); setScreen("home"); }}
          promptSaveStreak={promptSaveStreak}
          supabase={supabase}
          onStreakSaved={() => setPromptSaveStreak(false)}
        />
      )}

      {screen === "end" && (
        <EndScreen
          score={results.reduce((acc, r) => acc + Math.max(0, r.delta), 0)}
          maxScore={FLAGS.freeQuestionsPerDay * 100}
          results={results}
          strategy={strategy}
          streak={streak}
          rank={endRank}
          promptSaveStreak={promptSaveStreak}
          supabase={supabase}
          onBeforeOAuth={handleBeforeOAuth}
          onStreakSaved={() => {
            setPromptSaveStreak(false);
            if (pendingPlayAgain) {
              setPendingPlayAgain(false);
              setScreen("home"); setResults([]); setEndRank(null);
            }
          }}
          onPlayAgain={() => {
            const isAnon = session?.user?.is_anonymous ?? true;
            if (isAnon) {
              setPendingPlayAgain(true);
              setPromptSaveStreak(true);
            } else {
              const nextOffset = questionOffset + FLAGS.freeQuestionsPerDay;
              setResults([]); setEndRank(null); setPromptSaveStreak(false);
              handleStart(nextOffset, true);
            }
          }}
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
  root: { flex: 1, backgroundColor: "#0c0b09" },
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
