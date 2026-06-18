import { View, Text, TouchableOpacity } from "react-native";
import { CATEGORIES } from "../../config/categories";

// Beat (category) chip picker, shared by HomeScreen and QuestionScreen so the
// chip markup, the "All" pseudo-beat, and the active styling live in one place.
// `align` is "center" on Home (centered card) and "flex-start" mid-quiz.
const T = {
  ink:    "#0c0b09",
  card2:  "#242118",
  cream2: "#c8bfa8",
  amber:  "#e8a020",
  amber2: "#f5b940",
  muted:  "#6b6455",
  border: "rgba(232,160,32,0.15)",
};

const FONT = {
  mono: "JetBrainsMono-Bold",
  body: "Lato-Regular",
};

const ALL_BEAT = { id: null, label: "All", emoji: "✦" };

export default function BeatSelector({ selectedCategory = null, onSelect, scale = 1, align = "flex-start", notice }) {
  const s = (v) => v * scale;
  const textAlign = align === "center" ? "center" : "left";

  return (
    <View style={{ width: "100%", marginBottom: s(12) }}>
      <Text style={{ fontFamily: FONT.mono, fontSize: s(9), letterSpacing: s(1.5), textTransform: "uppercase", color: T.muted, textAlign, marginBottom: s(8) }}>
        Your Beat
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: s(6), justifyContent: align }}>
        {[ALL_BEAT, ...CATEGORIES].map((c) => {
          const active = (selectedCategory ?? null) === (c.id ?? null);
          return (
            <TouchableOpacity
              key={c.id ?? "all"}
              onPress={() => onSelect?.(c.id ?? null)}
              activeOpacity={0.8}
              style={{
                backgroundColor: active ? T.amber : T.card2,
                borderWidth: 1, borderColor: active ? T.amber : T.border,
                borderRadius: s(20), paddingVertical: s(5), paddingHorizontal: s(11),
              }}
            >
              <Text style={{ fontFamily: FONT.body, fontSize: s(11), color: active ? T.ink : T.cream2, fontWeight: active ? "700" : "400" }}>
                {c.emoji} {c.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {notice ? (
        <Text style={{ fontFamily: FONT.mono, fontSize: s(11), color: T.amber2, textAlign, marginTop: s(8) }}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
