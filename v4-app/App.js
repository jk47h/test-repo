// Experiment 3 (V-4): an Expo app as a web app on the iPhone, with an
// own service worker that holds on to the confirmed version (W-09).
// Throwaway code.

import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

// Step 8 of the experiment changes this text for the second build.
const STAND = "erster Bau";

/** Sends a message to the service worker and waits for its answer. */
async function askWorker(message) {
  const registration = await navigator.serviceWorker.ready;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve(event.data);
    registration.active.postMessage(message, [channel.port2]);
  });
}

export default function App() {
  const [confirmed, setConfirmed] = useState(null);
  const [latest, setLatest] = useState(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (Platform.OS !== "web" || !("serviceWorker" in navigator)) {
      setNote("Hier gibt es keinen Service Worker.");
      return;
    }
    navigator.serviceWorker
      .register("sw.js")
      .catch((error) => setNote(`Service Worker Fehler: ${error.message}`));
    askWorker({ type: "which" }).then((answer) =>
      setConfirmed(answer.confirmed),
    );
    fetch("version.json", { cache: "no-store" })
      .then((response) => response.json())
      .then((info) => setLatest(info.version))
      .catch(() =>
        setNote("Server nicht erreichbar, die App kommt aus dem Speicher."),
      );
  }, []);

  async function activate() {
    const answer = await askWorker({ type: "activate", version: latest });
    if (answer.error) {
      setNote(answer.error);
      return;
    }
    window.location.reload();
  }

  const standalone =
    Platform.OS === "web" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const waiting = confirmed && latest && confirmed !== latest;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Kopf frei Versuch 3</Text>
      <Text style={styles.line}>Stand: {STAND}</Text>
      <Text style={styles.line}>
        Vom Home-Bildschirm: {standalone ? "ja" : "nein"}
      </Text>
      <Text style={styles.line}>
        Bestätigte Version: {confirmed ?? "noch keine"}
      </Text>
      <Text style={styles.line}>
        Neueste auf dem Server: {latest ?? "unbekannt"}
      </Text>
      {waiting ? (
        <View style={styles.card}>
          <Text style={styles.line}>Neue Version {latest}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={activate}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Aktivieren</Text>
          </Pressable>
        </View>
      ) : null}
      {note ? <Text style={styles.line}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 64, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "600", marginBottom: 16 },
  line: { fontSize: 16, marginBottom: 8 },
  card: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#eef3f0",
  },
  button: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2f5d50",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});