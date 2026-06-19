import "react-native-url-polyfill/auto";
import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts, PlayfairDisplay_900Black } from "@expo-google-fonts/playfair-display";
import { JetBrainsMono_700Bold, JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono";
import { Lato_400Regular, Lato_300Light } from "@expo-google-fonts/lato";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { CATEGORIES } from "../config/categories";
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
  const [points,      setPoints]      = useState(0);          // lifetime score (server-authoritative)
  const [answeredTotal, setAnsweredTotal] = useState(0);      // lifetime non-skip answers
  const [correctTotal,  setCorrectTotal]  = useState(0);      // lifetime correct answers
  const [streak,      setStreak]      = useState(0);
  const [beatNotice,  setBeatNotice]  = useState(null);       // transient mid-quiz beat-switch message
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

  // Lifetime accuracy, derived from the cumulative answered/correct totals.
  const accuracy = answeredTotal > 0 ? Math.round((correctTotal / answeredTotal) * 100) : 0;
  const canChooseBeat = FLAGS.beatEnabled && isSignedIn;

  // Guards a beat switch in flight so rapid chip taps can't fire concurrent
  // submit/fetch races (mismatched beat vs. loaded questions, double submits).
  const switchingBeat = useRef(false);

  // Auto-dismiss the transient beat-switch notice, cleaning up on unmount/re-set.
  useEffect(() => {
    if (!beatNotice) return undefined;
    const t = setTimeout(() => setBeatNotice(null), 4000);
    return () => clearTimeout(t);
  }, [beatNotice]);

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
          // A guest is a persisted ANONYMOUS user. Hydrate streak for them (the
          // daily-ritual hook), but NOT the cumulative lifetime score — loading
          // a guest's stored total here is what made a guest show a stale score
          // (e.g. 125) on a fresh load. Real accounts hydrate everything; anon
          // sessions keep the zeroed lifetime state and show session-only
          // progress (the server still records anon attempts for the eventual
          // sign-in/linkIdentity merge).
          const isAnon = session.user?.is_anonymous ?? true;
          loadUserData(session.user.id, { hydrateLifetime: !isAnon });
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

  // Streak is hydrated for everyone (it's the daily-ritual hook shown to guests
  // too, and drives the save-streak prompt); the cumulative lifetime stats
  // (score/accuracy/answered) are a signed-in feature, so pass hydrateLifetime:
  // false for anonymous guests to keep them at the zeroed session-only state.
  const loadUserData = async (userId, { hydrateLifetime = true } = {}) => {
    // Prefer the denormalized lifetime columns; fall back if the migration that
    // adds them hasn't landed yet so streak/points still load.
    let { data } = await supabase
      .from("users")
      .select("streak, total_points, total_answered, total_correct")
      .eq("id", userId)
      .single();
    if (!data) {
      ({ data } = await supabase
        .from("users")
        .select("streak, total_points")
        .eq("id", userId)
        .single());
    }
    if (data) {
      setStreak(data.streak ?? 0);
      if (hydrateLifetime) {
        setPoints(data.total_points ?? 0);
        setAnsweredTotal(data.total_answered ?? 0);
        setCorrectTotal(data.total_correct ?? 0);
      }
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    const { data } = await supabase.auth.signInAnonymously();
    if (data?.session) setSession(data.session);
    setStreak(0);
    setPoints(0);
    setAnsweredTotal(0);
    setCorrectTotal(0);
  };

  const handleBeforeOAuth = () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("quydly_oauth_resume", JSON.stringify({
        screen, results, endRank, pendingPlayAgain,
      }));
    }
  };

  // ── Handlers ────────────────────────────────────────────────────────────────
  // Fetch a page of questions for the given beat (category id or null = all).
  // Shared by the initial start and mid-quiz beat switching.
  const fetchQuestions = async (category) => {
    const headers = {};
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
    // 8.6 — detect India locale via timezone; expo-localization not installed
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const isIndia = tz === "Asia/Kolkata" || tz === "Asia/Calcutta";
    const params = new URLSearchParams();
    if (isIndia) params.set("audience", "india");
    // Beat filter is signed-in only; guests always get the editorial mix.
    if (isSignedIn && category) params.set("category", category);
    const qs = params.toString();
    const res = await fetch(`${API_BASE}/api/questions${qs ? `?${qs}` : ""}`, { headers });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  };

  // Load a freshly fetched page into a clean run. Cumulative score/accuracy/
  // answered are NOT touched here — they persist across runs and beats.
  const loadRun = (data) => {
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
  };

  const handleStart = async (skipCreditCheck = false) => {
    if (!skipCreditCheck && !isSignedIn && credits <= 0) { setScreen("gate"); return; }
    setLoadError(null);
    setScreen("loading");
    try {
      const data = await fetchQuestions(selectedCategory);
      if (data.allCaughtUp) {
        setAllCaughtUp(true);
        setScreen("end");
        return;
      }
      loadRun(data);
    } catch {
      setLoadError("Couldn't load today's questions. Check your connection and try again.");
      setScreen("home");
    }
  };

  // Switch beat mid-quiz (signed-in unlimited only). Submits the answers so far
  // so they're checkpointed and the cumulative stats stay accurate, then loads
  // the new beat's next page. The lifetime score never resets across the swap.
  const beatLabel = (id) => (id ? (CATEGORIES.find((c) => c.id === id)?.label ?? "this beat") : "All");
  const handleChangeBeat = async (rawCategory) => {
    const next = rawCategory ?? null;
    if (next === (selectedCategory ?? null) || switchingBeat.current) return;
    switchingBeat.current = true;
    setBeatNotice(null);
    setScreen("loading");
    try {
      // Checkpoint the answers so far BEFORE fetching: serve_unseen only excludes
      // questions already in user_question_attempts, so fetching first could
      // re-serve a just-answered question when switching to an overlapping beat
      // (e.g. All → its category). Only clear results / proceed once the
      // checkpoint actually succeeded — otherwise the answers would be dropped
      // from any later completion AND re-served (they never reached the ledger).
      if (isSignedIn && results.length > 0) {
        const ok = await submitCompletion();
        if (!ok) {
          setScreen("quiz");
          setBeatNotice("Couldn't save your progress — staying on this beat.");
          return;
        }
        setResults([]);
      }
      const data = await fetchQuestions(next);
      if (data.allCaughtUp || !data.questions?.length) {
        // Target beat has no unseen questions — don't strand the player. Keep
        // them on their current run (beat unchanged) and surface a notice.
        setScreen("quiz");
        setBeatNotice(`No new questions in ${beatLabel(next)} right now.`);
        return;
      }
      // Switch confirmed: load the new beat.
      setSelectedCategory(next);
      loadRun(data);
    } catch {
      setScreen("quiz");
      setBeatNotice("Couldn't switch beat. Please try again.");
    } finally {
      switchingBeat.current = false;
    }
  };

  const handleAnswer = (idx) => {
    const q = questions[currentQ];
    const correct = idx === q.correctIndex;
    const delta = correct ? wager : -Math.floor(wager / 2);
    // Lifetime score never decreases (server only adds positive deltas), so
    // mirror that here; submitCompletion reconciles to the authoritative total.
    setPoints((p) => p + Math.max(0, delta));
    setAnsweredTotal((a) => a + 1);
    if (correct) setCorrectTotal((c) => c + 1);
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

  // Submit the run so far (points, streak, rank). Used by the natural
  // end-of-pool finish, the "quit anytime" path, and the beat switch.
  // Returns true only if the completion was actually checkpointed server-side;
  // callers that must not lose/duplicate answers (beat switch) gate on this.
  const submitCompletion = async () => {
    if (!session) return false;
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
      if (!resp.ok) return false;   // 401/500 etc. — attempts NOT recorded
      const data = await resp.json();
      if (data.streak !== undefined) setStreak(data.streak);
      // Reconcile cumulative stats to the server-authoritative totals (which
      // already include this run's attempts). Setting (not adding) is what keeps
      // repeated submits — e.g. a beat switch mid-run — from double-counting.
      // Signed-in only: the lifetime display is a signed-in feature, so a guest
      // keeps their session-local optimistic stats instead of pulling back the
      // server cumulative (which would re-surface the stale lifetime score).
      if (isSignedIn) {
        if (data.totalPoints !== undefined) setPoints(data.totalPoints);
        if (data.totalAnswered != null) setAnsweredTotal(data.totalAnswered);
        if (data.totalCorrect != null) setCorrectTotal(data.totalCorrect);
      }
      if (data.rank !== undefined) setEndRank(data.rank);
      if (data.promptSaveStreak) setPromptSaveStreak(true);
      return true;
    } catch {
      return false;   // network failure — attempts NOT recorded
    }
  };

  const handleNext = async () => {
    const total = questions.length || FLAGS.freeQuestionsPerDay;
    if (currentQ + 1 < total) {
      // Still inside the loaded page — advance to the next question.
      setCurrentQ((q) => q + 1);
      setAnswered(false);
      setSelectedIdx(null);
      setSkipped(false);
      setWager(25);
      return;
    }

    // Reached the end of the loaded page. Checkpoint what's been answered so the
    // cumulative stats stay accurate either way.
    await submitCompletion();

    // Anonymous users play a fixed session; the page IS the pool, so its end is
    // the natural finish → show results. (They must never run unbounded — see the
    // sign-in gating notes around handleQuit/QuestionScreen.)
    if (!isSignedIn) {
      setScreen("end");
      return;
    }

    // Signed-in users get questions nonstop: pull the next page and continue.
    // Only stop when the server says they've exhausted the pool (allCaughtUp /
    // no more questions), at which point the end/caught-up state is reached.
    setScreen("loading");
    try {
      const data = await fetchQuestions(selectedCategory);
      if (data.allCaughtUp || !data.questions?.length) {
        setAllCaughtUp(!!data.allCaughtUp);
        setScreen("end");
        return;
      }
      // loadRun clears `results` so the just-checkpointed answers aren't
      // re-counted by the next completion, and resets per-question UI state.
      loadRun(data);
    } catch {
      // Couldn't fetch more — don't strand the player; show their results so far.
      setScreen("end");
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
          score={points}
          accuracy={accuracy}
          answered={answeredTotal}
          canChooseBeat={canChooseBeat}
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
          lifetimeScore={points}
          accuracy={accuracy}
          lifetimeAnswered={answeredTotal}
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
          score={points}
          accuracy={accuracy}
          answeredCount={answeredTotal}
          canChooseBeat={canChooseBeat}
          selectedCategory={selectedCategory}
          onChangeBeat={handleChangeBeat}
          beatNotice={beatNotice}
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
