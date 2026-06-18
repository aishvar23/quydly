import { View, Text } from "react-native";

// Cumulative, always-visible stats: Score / Accuracy / Answered. These are the
// user's lifetime totals and never reset — the single source of truth. Rendered
// on Home, Question, and End screens so the player always sees their standing.
const T = {
  card:   "#1c1a17",
  amber:  "#e8a020",
  muted:  "#6b6455",
  border: "rgba(232,160,32,0.15)",
};

const FONT = {
  mono: "JetBrainsMono-Bold",
  body: "Lato-Regular",
};

export default function StatsBar({ score = 0, accuracy = 0, answered = 0, scale = 1 }) {
  const s = (v) => v * scale;
  const chips = [
    { val: score,          lbl: "Score" },
    { val: `${accuracy}%`, lbl: "Accuracy" },
    { val: answered,       lbl: "Answered" },
  ];

  return (
    <View style={{ flexDirection: "row", gap: s(8), marginBottom: s(14) }}>
      {chips.map(({ val, lbl }) => (
        <View
          key={lbl}
          style={{
            flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
            borderRadius: s(10), paddingVertical: s(10), paddingHorizontal: s(8), alignItems: "center",
          }}
        >
          <Text style={{ fontFamily: FONT.mono, fontSize: s(20), fontWeight: "700", color: T.amber, lineHeight: s(22) }}>
            {val}
          </Text>
          <Text style={{ fontFamily: FONT.body, fontSize: s(9), textTransform: "uppercase", letterSpacing: s(1), color: T.muted, marginTop: s(3), fontWeight: "600" }}>
            {lbl}
          </Text>
        </View>
      ))}
    </View>
  );
}
