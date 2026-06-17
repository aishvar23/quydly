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
import SingleQuestionScreen from "./screens/SingleQuestionScreen";
import { getActiveStrategy } from "./services/contentStrategy";
import { isIdentityConflict, readOAuthErrorFromUrl } from "./services/authConflicts";
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

// Detect the shareable single-question deep link (web only): /question/<uuid>.
// Returns the question id, or null for the normal app. X reply links point here.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readSingleQuestionId() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const m = window.location.pathname.match(/^\/question\/([^/?#]+)/i);
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

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

function AuthErrorBanner({ message }) {
  const TOP = Platform.OS === "ios" ? 44 : Platform.OS === "android" ? 28 : 0;
  return (
    <View style={{
      position: "absolute", top: TOP, left: 0, right: 0, zIndex: 200,
      backgroundColor: "#d94040", paddingVertical: 10, paddingHorizontal: 16, alignItems: "center",
    }}>
      <Text style={{ fontFamily: "JetBrainsMono-Bold", fontSize: 12, color: "#0c0b09", letterSpacing: 0.5, textAlign: "center" }}>
        {message}
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

  const [session,     setSession]     = useState(null);
  const [singleQuestionId] = useState(readSingleQuestionId); // non-null → shareable single-question page
  const [screen,      setScreen]      = useState("home");
  const [questions,   setQuestions]   = useState([]);
  const [currentQ,    setCurrentQ]    = useState(0);
  const [allCaughtUp, setAllCaughtUp] = useState(false);
  const [answered,    setAnswered]    = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [skipped,     setSkipped]     = useState(false);
  const [unlimited,   setUnlimited]   = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null); // null = all beats
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
  const [authError,        setAuthError]        = useState(null); // post-redirect OAuth error

  // Signed-in (non-anonymous) users get unlimited play and no credit gate.
  const isSignedIn = !!session && !(session.user?.is_anonymous ?? true);

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // If this is an OAuth redirect (hash contains access_token), skip the
    // anonymous sign-in — onAuthStateChange will fire with the real session.
    const isOAuthRedirect =
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      window.location.hash.includes("access_token");

    const canStore = typeof sessionStorage !== "undefined";
    const cleanUrl = () => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.history.replaceState(null, "", window.location.pathname);
      }
    };

    // A successful sign-in came back — clear the conflict-retry guard so a
    // future genuine conflict can retry again.
    if (isOAuthRedirect && canStore) {
      sessionStorage.removeItem("quydly_oauth_conflict_retry");
    }

    // linkIdentity()/signInWithOAuth() with an OAuth provider redirect before
    // any conflict is known — a failure comes back here as URL params, which
    // nothing else reads (no access_token hash → not treated as a redirect).
    const oauthErr = Platform.OS === "web" ? readOAuthErrorFromUrl() : null;
    let handlingConflict = false;
    if (oauthErr) {
      const alreadyRetried =
        canStore && sessionStorage.getItem("quydly_oauth_conflict_retry") === "1";

      if (isIdentityConflict(oauthErr) && !alreadyRetried) {
        // The Google account is already linked to another user. linkIdentity
        // can't merge them, so sign the user into that existing account; their
        // progress resumes from there. Retry once to avoid a redirect loop.
        handlingConflict = true;
        if (canStore) sessionStorage.setItem("quydly_oauth_conflict_retry", "1");
        cleanUrl();
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
          },
        }).then(({ error }) => {
          if (error) {
            setAuthError(error.message ?? "Sign-in failed. Please try again.");
            setTimeout(() => setAuthError(null), 6000);
          }
        });
      } else {
        // Any other error (or a conflict that didn't resolve on retry) must
        // surface rather than fail silently.
        if (canStore) sessionStorage.removeItem("quydly_oauth_conflict_retry");
        setAuthError(
          isIdentityConflict(oauthErr)
            ? "Couldn't sign you in with Google. Please try again."
            : (oauthErr.message || "Sign-in failed. Please try again."),
        );
        setTimeout(() => setAuthError(null), 6000);
        cleanUrl();
      }
    }

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

    // Skip while a conflict retry is redirecting — don't spawn a new anon user.
    if (!handlingConflict) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setSession(session);
          loadUserData(session.user.id);
        } else if (!isOAuthRedirect && !singleQuestionId) {
          // Skip anonymous provisioning for public single-question share visitors
          // — a brand-new anon user per share-link hit would balloon auth.users.
          // They only need a session if they choose to sign in (handled in modal).
          supabase.auth.signInAnonymously().then(({ data, error }) => {
            if (!error) setSession(data.session);
          });
        }
      });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (s && !s.user.is_anonymous) {
        loadUserData(s.user.id);
        // Clean the OAuth hash from the URL so it doesn't persist on refresh
        if (Platform.OS === "web" && typeof window !== "undefined" && window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        // Show a brief "signed in" confirmation banner.
        // USER_UPDATED fires after linkIdentity / updateUser upgrades an anon
        // user to a permanent one — treat that as a successful sign-in too.
        if (event === "SIGNED_IN" || event === "USER_UPDATED") {
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
  const handleStart = async (skipCreditCheck = false) => {
    if (!skipCreditCheck && !isSignedIn && credits <= 0) { setScreen("gate"); return; }
    setLoadError(null);
    setScreen("loading");
    try {
      const headers = {};
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      // 8.6 — detect India locale via timezone; expo-localization not installed
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const isIndia = tz === "Asia/Kolkata" || tz === "Asia/Calcutta";
      const params = new URLSearchParams();
      if (isIndia) params.set("audience", "india");
      // Beat filter is signed-in only; guests always get the editorial mix.
      if (isSignedIn && selectedCategory) params.set("category", selectedCategory);
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/api/questions${qs ? `?${qs}` : ""}`, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();

      if (data.allCaughtUp) {
        setAllCaughtUp(true);
        setScreen("end");
        return;
      }

      setQuestions(data.questions);
      setUnlimited(!!data.unlimited);
      setCredits(data.unlimited ? Infinity : FLAGS.freeQuestionsPerDay);
      setAllCaughtUp(false);
      setCurrentQ(0);
      setAnswered(false);
      setSelectedIdx(null);
      setSkipped(false);
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
    if (!isSignedIn) setCredits((c) => Math.max(0, c - 1));
    setSelectedIdx(idx);
    setSkipped(false);
    setAnswered(true);
    setResults((prev) => [...prev, { id: q.id, correct, delta, categoryId: q.categoryId }]);
  };

  // Skip & reveal — no points, no penalty. Recorded as not-correct so it
  // never counts toward the grade, but never costs anything either.
  const handleSkip = () => {
    const q = questions[currentQ];
    if (!isSignedIn) setCredits((c) => Math.max(0, c - 1));
    setSelectedIdx(null);
    setSkipped(true);
    setAnswered(true);
    setResults((prev) => [...prev, { id: q.id, correct: false, delta: 0, categoryId: q.categoryId, skipped: true }]);
  };

  // Submit the run so far (points, streak, rank). Used by both the natural
  // end-of-pool finish and the "quit anytime" path.
  const submitCompletion = async () => {
    if (!session) return;
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
  };

  const handleNext = async () => {
    const total = questions.length || FLAGS.freeQuestionsPerDay;
    if (currentQ + 1 >= total) {
      await submitCompletion();
      setScreen("end");
    } else {
      setCurrentQ((q) => q + 1);
      setAnswered(false);
      setSelectedIdx(null);
      setSkipped(false);
      setWager(25);
    }
  };

  // Quit anytime → see results for what's been answered so far. Unlimited
  // (signed-in) only: anonymous users keep the fixed 5-question session, so
  // they must never early-finalize a completion via this path.
  const handleQuit = async () => {
    if (!isSignedIn) { setScreen("home"); return; }
    if (results.length === 0) { setScreen("home"); return; }
    await submitCompletion();
    setScreen("end");
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
      {authError && <AuthErrorBanner message={authError} />}

      <SaveStreakModal
        visible={showLoginModal}
        streak={streak}
        supabase={supabase}
        mode="login"
        onSuccess={() => setShowLoginModal(false)}
        onDismiss={() => setShowLoginModal(false)}
        onBeforeOAuth={handleBeforeOAuth}
      />

      {singleQuestionId && (
        <SingleQuestionScreen
          questionId={singleQuestionId}
          apiBase={API_BASE}
          isSignedIn={isSignedIn}
          onPlayFull={() => {
            if (Platform.OS === "web" && typeof window !== "undefined") {
              window.location.assign(`${window.location.origin}/`);
            }
          }}
          onSignIn={() => setShowLoginModal(true)}
        />
      )}

      {!singleQuestionId && screen === "loading" && (
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Scanning headlines...</Text>
          <Text style={styles.loadingSub}>Loading today's edition</Text>
        </View>
      )}

      {!singleQuestionId && loadError && screen === "home" && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      )}

      {!singleQuestionId && screen === "home" && (
        <HomeScreen
          onStart={() => handleStart(0)}
          credits={isSignedIn ? Infinity : credits}
          strategy={strategy}
          streak={streak}
          points={points}
          answered={results.length}
          canChooseBeat={FLAGS.beatEnabled && isSignedIn}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />
      )}

      {!singleQuestionId && screen === "gate" && (
        <GateScreen
          onReset={() => { setCredits(FLAGS.freeQuestionsPerDay); setScreen("home"); }}
          promptSaveStreak={promptSaveStreak}
          supabase={supabase}
          onStreakSaved={() => setPromptSaveStreak(false)}
        />
      )}

      {!singleQuestionId && screen === "end" && (
        <EndScreen
          score={results.reduce((acc, r) => acc + Math.max(0, r.delta), 0)}
          maxScore={results.filter((r) => !r.skipped).length * 100}
          attempted={results.filter((r) => !r.skipped).length}
          skippedCount={results.filter((r) => r.skipped).length}
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
              setResults([]); setEndRank(null); setPromptSaveStreak(false);
              handleStart(true);
            }
          }}
          allCaughtUp={allCaughtUp}
        />
      )}

      {!singleQuestionId && screen === "quiz" && currentQ < questions.length && questions[currentQ] && (
        <QuestionScreen
          question={questions[currentQ]}
          onAnswer={handleAnswer}
          onNext={handleNext}
          onSkip={handleSkip}
          onQuit={handleQuit}
          answered={answered}
          skipped={skipped}
          selectedIndex={selectedIdx}
          wager={wager}
          setWager={setWager}
          currentQ={currentQ}
          totalQ={questions.length}
          unlimited={unlimited}
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
