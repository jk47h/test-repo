// Experiment 5 (V-1, V-8): the screen of the Android test app. Three
// buttons start the measurements, the log shows the results.
// Throwaway code.

import { useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text } from "react-native";

import { measureCrypto, measureDatabase, readAgain } from "./measure";

export default function App() {
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  /** Adds a line to the log on the screen. */
  function log(line) {
    setLines((previous) => [...previous, line]);
  }

  /** Runs one measurement; only one at a time. */
  async function run(measurement) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await measurement(log);
    } catch (error) {
      log(`Fehler: ${error.name}: ${error.message}`);
    }
    log("fertig");
    setBusy(false);
  }

  /** Opens the share sheet with the log, e.g. to send it to yourself. */
  function shareLog() {
    Share.share({ message: lines.join("\n") });
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Kopf frei Versuch 5</Text>
      <Button
        label="1. Verschlüsselung messen"
        onPress={() => run(measureCrypto)}
      />
      <Button
        label="2. Datenbank messen"
        onPress={() => run(measureDatabase)}
      />
      <Button label="3. Nach Neustart lesen" onPress={() => run(readAgain)} />
      <Button label="Log teilen" onPress={shareLog} />
      {busy ? <Text style={styles.line}>Messung läuft …</Text> : null}
      {lines.map((line, index) => (
        <Text key={index} style={styles.log}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

/** A large button, at least 48 dp high as Android recommends. */
function Button({ label, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 24, paddingTop: 64, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "600", marginBottom: 16 },
  line: { fontSize: 16, marginTop: 8 },
  button: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2f5d50",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  log: { fontSize: 13, marginTop: 4, fontFamily: "monospace" },
});