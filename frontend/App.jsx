import { View, Text, StyleSheet } from "react-native";

export default function App() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>Quydly is alive</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0c0b09", alignItems: "center", justifyContent: "center" },
  text: { color: "#e8a020", fontSize: 24 },
});
