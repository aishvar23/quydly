import { useState } from "react";
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, useWindowDimensions } from "react-native";

// ── Tokens ────────────────────────────────────────────────────────────────────
const T = {
  ink:    "#0c0b09",
  card:   "#1c1a17",
  card2:  "#242118",
  cream:  "#f2ead8",
  cream2: "#c8bfa8",
  amber:  "#e8a020",
  amber2: "#f5b940",
  green:  "#3aaa72",
  muted:  "#6b6455",
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
const BASE_WIDTH = 600;

// ── SaveStreakModal ───────────────────────────────────────────────────────────
// Props:
//   visible         — bool
//   streak          — number
//   supabase        — Supabase client
//   onSuccess       — () => void  called after successful sign-in
//   onDismiss       — () => void  called when user taps "Maybe later"
export default function SaveStreakModal({ visible, streak, supabase, onSuccess, onDismiss }) {
  const { width } = useWindowDimensions();
  const scale = Math.min(width, MAX_WIDTH) / BASE_WIDTH;
  const s = (v) => v * scale;

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [saved,   setSaved]   = useState(false);

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: linkErr } = await supabase.auth.linkIdentity({ provider: "google" });
      if (linkErr) throw linkErr;
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onSuccess();
      }, 1500);
    } catch (err) {
      setError(err.message ?? "Sign-in failed. Please try again.");
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
          {saved ? (
            <>
              <Text style={{ fontSize: s(40), marginBottom: s(12) }}>✓</Text>
              <Text style={{
                fontFamily: FONT.display,
                fontSize: s(22),
                color: T.green,
                textAlign: "center",
              }}>
                Streak saved!
              </Text>
            </>
          ) : (
            <>
              {/* Icon + heading */}
              <Text style={{ fontSize: s(40), marginBottom: s(16) }}>🔥</Text>
              <Text style={{
                fontFamily: FONT.display,
                fontSize: s(22),
                color: T.cream,
                textAlign: "center",
                marginBottom: s(12),
              }}>
                Your streak is worth saving
              </Text>
              <Text style={{
                fontFamily: FONT.body,
                fontSize: s(13),
                color: T.muted,
                textAlign: "center",
                lineHeight: s(20),
                marginBottom: s(28),
              }}>
                {`You're on a ${streak}-day streak.\nSign in to keep it — takes 10 seconds.`}
              </Text>

              {/* Google button */}
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
                  marginBottom: s(16),
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? (
                  <ActivityIndicator color={T.ink} />
                ) : (
                  <>
                    <Text style={{ fontSize: s(14) }}>G</Text>
                    <Text style={{
                      fontFamily: FONT.mono,
                      fontSize: s(13),
                      fontWeight: "700",
                      color: T.ink,
                      letterSpacing: s(0.3),
                    }}>
                      Continue with Google
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Error */}
              {error && (
                <Text style={{
                  fontFamily: FONT.body,
                  fontSize: s(12),
                  color: "#d94040",
                  textAlign: "center",
                  marginBottom: s(12),
                }}>
                  {error}
                </Text>
              )}

              {/* Dismiss */}
              <TouchableOpacity onPress={onDismiss} activeOpacity={0.6}>
                <Text style={{
                  fontFamily: FONT.monoReg,
                  fontSize: s(12),
                  color: T.muted,
                }}>
                  Maybe later →
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
