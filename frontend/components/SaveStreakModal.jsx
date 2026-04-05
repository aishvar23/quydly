import { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, ActivityIndicator,
  TextInput, useWindowDimensions, KeyboardAvoidingView, Platform,
} from "react-native";

// ── Tokens ────────────────────────────────────────────────────────────────────
const T = {
  ink:    "#0c0b09",
  card:   "#1c1a17",
  card2:  "#242118",
  cream:  "#f2ead8",
  cream2: "#c8bfa8",
  amber:  "#e8a020",
  green:  "#3aaa72",
  muted:  "#6b6455",
  border:  "rgba(232,160,32,0.15)",
  border2: "rgba(232,160,32,0.30)",
  red:    "#d94040",
};

const FONT = {
  display: "PlayfairDisplay-Black",
  mono:    "JetBrainsMono-Bold",
  monoReg: "JetBrainsMono-Regular",
  body:    "Lato-Regular",
};

const MAX_WIDTH  = 900;
const BASE_WIDTH = 600;

// ── SaveStreakModal ───────────────────────────────────────────────────────────
// Props:
//   visible   — bool
//   streak    — number
//   supabase  — Supabase client
//   onSuccess — () => void  called after successful sign-in
//   onDismiss — () => void  called when user taps "Maybe later"
export default function SaveStreakModal({ visible, streak, supabase, onSuccess, onDismiss, onBeforeOAuth, mode = "streak" }) {
  const { width } = useWindowDimensions();
  const scale = Math.min(width, MAX_WIDTH) / BASE_WIDTH;
  const s = (v) => v * scale;

  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [saved,         setSaved]         = useState(false);
  const [email,         setEmail]         = useState("");
  const [emailSent,     setEmailSent]     = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  const showSuccess = () => {
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onSuccess();
    }, 1500);
  };

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      // Save quiz state before the redirect so it can be restored on return
      onBeforeOAuth?.();
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (oauthErr) throw oauthErr;
      // linkIdentity redirects — success handled after redirect via onAuthStateChange in App.jsx
    } catch (err) {
      setError(err.message ?? "Google sign-in failed. Please try again.");
      setLoading(false);
    }
  };

  const handleEmailMagicLink = async () => {
    if (!email.trim()) { setError("Enter your email address."); return; }
    setLoading(true);
    setError(null);
    try {
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (otpErr) throw otpErr;
      setEmailSent(true);
    } catch (err) {
      setError(err.message ?? "Could not send link. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={{
          flex: 1,
          backgroundColor: "rgba(12,11,9,0.85)",
          justifyContent: "center",
          alignItems: "center",
          padding: s(24),
        }}>
          <View style={{
            width: "100%",
            maxWidth: s(420),
            backgroundColor: T.card,
            borderWidth: 1,
            borderColor: T.border2,
            borderRadius: s(20),
            padding: s(32),
            alignItems: "center",
          }}>
            {/* ── Success state ── */}
            {saved ? (
              <>
                <Text style={{ fontSize: s(40), marginBottom: s(12) }}>✓</Text>
                <Text style={{ fontFamily: FONT.display, fontSize: s(22), color: T.green, textAlign: "center" }}>
                  You're in!
                </Text>
              </>

            /* ── Magic link sent ── */
            ) : emailSent ? (
              <>
                <Text style={{ fontSize: s(36), marginBottom: s(12) }}>📬</Text>
                <Text style={{ fontFamily: FONT.display, fontSize: s(20), color: T.cream, textAlign: "center", marginBottom: s(10) }}>
                  Check your inbox
                </Text>
                <Text style={{ fontFamily: FONT.body, fontSize: s(13), color: T.muted, textAlign: "center", lineHeight: s(20), marginBottom: s(24) }}>
                  We sent a magic link to{" "}
                  <Text style={{ color: T.amber }}>{email}</Text>
                  {". Click it to sign in."}
                </Text>
                <TouchableOpacity onPress={onDismiss} activeOpacity={0.6}>
                  <Text style={{ fontFamily: FONT.monoReg, fontSize: s(12), color: T.muted }}>
                    Got it →
                  </Text>
                </TouchableOpacity>
              </>

            /* ── Email form ── */
            ) : showEmailForm ? (
              <>
                <Text style={{ fontSize: s(36), marginBottom: s(14) }}>✉️</Text>
                <Text style={{ fontFamily: FONT.display, fontSize: s(20), color: T.cream, textAlign: "center", marginBottom: s(20) }}>
                  Sign in with email
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="your@email.com"
                  placeholderTextColor={T.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    width: "100%",
                    paddingVertical: s(12),
                    paddingHorizontal: s(14),
                    backgroundColor: T.card2,
                    borderWidth: 1,
                    borderColor: T.border2,
                    borderRadius: s(10),
                    fontFamily: FONT.body,
                    fontSize: s(14),
                    color: T.cream,
                    marginBottom: s(14),
                  }}
                />
                {error && (
                  <Text style={{ fontFamily: FONT.body, fontSize: s(12), color: T.red, textAlign: "center", marginBottom: s(12) }}>
                    {error}
                  </Text>
                )}
                <TouchableOpacity
                  onPress={handleEmailMagicLink}
                  disabled={loading}
                  activeOpacity={0.85}
                  style={{
                    width: "100%",
                    paddingVertical: s(14),
                    backgroundColor: T.amber,
                    borderRadius: s(11),
                    alignItems: "center",
                    marginBottom: s(14),
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading
                    ? <ActivityIndicator color={T.ink} />
                    : <Text style={{ fontFamily: FONT.mono, fontSize: s(13), fontWeight: "700", color: T.ink, letterSpacing: s(0.3) }}>
                        Send magic link →
                      </Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setShowEmailForm(false); setError(null); }} activeOpacity={0.6}>
                  <Text style={{ fontFamily: FONT.monoReg, fontSize: s(12), color: T.muted }}>← Back</Text>
                </TouchableOpacity>
              </>

            /* ── Default: sign-in options ── */
            ) : (
              <>
                <Text style={{ fontSize: s(40), marginBottom: s(16) }}>
                  {mode === "login" ? "👋" : "🎲"}
                </Text>
                <Text style={{
                  fontFamily: FONT.display,
                  fontSize: s(22),
                  color: T.cream,
                  textAlign: "center",
                  marginBottom: s(10),
                }}>
                  {mode === "login" ? "Welcome to Quydly" : "Want to play with different questions?"}
                </Text>
                <Text style={{
                  fontFamily: FONT.body,
                  fontSize: s(13),
                  color: T.muted,
                  textAlign: "center",
                  lineHeight: s(20),
                  marginBottom: s(28),
                }}>
                  {mode === "login"
                    ? "Sign in to save your streak and track your progress."
                    : streak > 1
                      ? `Sign in to keep your ${streak}-day streak and unlock more rounds.`
                      : "Sign in to save your progress and play more."}
                </Text>

                {/* Google */}
                <TouchableOpacity
                  onPress={handleGoogle}
                  disabled={loading}
                  activeOpacity={0.85}
                  style={{
                    width: "100%",
                    paddingVertical: s(14),
                    backgroundColor: T.amber,
                    borderRadius: s(11),
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: s(8),
                    marginBottom: s(10),
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading
                    ? <ActivityIndicator color={T.ink} />
                    : <>
                        <Text style={{ fontSize: s(14) }}>G</Text>
                        <Text style={{ fontFamily: FONT.mono, fontSize: s(13), fontWeight: "700", color: T.ink, letterSpacing: s(0.3) }}>
                          Continue with Google
                        </Text>
                      </>
                  }
                </TouchableOpacity>

                {/* Email */}
                <TouchableOpacity
                  onPress={() => { setShowEmailForm(true); setError(null); }}
                  activeOpacity={0.85}
                  style={{
                    width: "100%",
                    paddingVertical: s(13),
                    backgroundColor: "transparent",
                    borderWidth: 1,
                    borderColor: T.border2,
                    borderRadius: s(11),
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: s(8),
                    marginBottom: s(20),
                  }}
                >
                  <Text style={{ fontSize: s(14) }}>✉️</Text>
                  <Text style={{ fontFamily: FONT.mono, fontSize: s(13), fontWeight: "700", color: T.cream2, letterSpacing: s(0.3) }}>
                    Continue with Email
                  </Text>
                </TouchableOpacity>

                {error && (
                  <Text style={{ fontFamily: FONT.body, fontSize: s(12), color: T.red, textAlign: "center", marginBottom: s(12) }}>
                    {error}
                  </Text>
                )}

                <TouchableOpacity onPress={onDismiss} activeOpacity={0.6}>
                  <Text style={{ fontFamily: FONT.monoReg, fontSize: s(12), color: T.muted }}>
                    Maybe later →
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
