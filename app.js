// Experiment 1 for phase 2: persistent storage (V-6) and a passkey
// with the PRF extension (V-7) on the iPhone. Throwaway code: no
// build step, no library, plain browser APIs.

const logBox = document.getElementById("log");

/** Writes one line to the page and keeps it after a restart. */
function log(text) {
  const line = `${new Date().toLocaleTimeString("de-DE")}  ${text}`;
  logBox.textContent += line + "\n";
  try {
    localStorage.setItem("log", logBox.textContent);
  } catch {
    // Storage may be blocked; the line is still on the page.
  }
}

/** Random bytes, e.g. for a challenge. */
function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Bytes as hex text, e.g. "3fa1". */
function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Bytes as base64url text, to keep the credential id. */
function toBase64Url(buffer) {
  const text = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url text back to bytes. */
function fromBase64Url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/**
 * The fixed salt for PRF. The same salt must give the same secret
 * every time; that is what the experiment checks.
 */
async function prfSalt() {
  const text = new TextEncoder().encode("kopf-frei-versuch-1-prf-salt");
  return new Uint8Array(await crypto.subtle.digest("SHA-256", text));
}

/**
 * A short fingerprint of the PRF secret: the first 8 bytes of its
 * SHA-256 hash. It shows whether two secrets are equal without
 * showing the secret itself.
 */
async function fingerprint(secret) {
  const hash = await crypto.subtle.digest("SHA-256", secret);
  return toHex(hash).slice(0, 16);
}

/** 0. Device, browser and whether the app runs from the home screen. */
function showInfo() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;
  log(`Browser: ${navigator.userAgent}`);
  log(`Vom Home-Bildschirm gestartet: ${standalone ? "ja" : "nein"}`);
  log(
    `Service Worker moeglich: ${"serviceWorker" in navigator ? "ja" : "nein"}`,
  );
  log(`Passkeys moeglich: ${window.PublicKeyCredential ? "ja" : "nein"}`);
}

/** 1. Asks for persistent storage (V-6). */
async function askPersist() {
  if (!navigator.storage || !navigator.storage.persist) {
    log("V-6: navigator.storage.persist gibt es hier nicht.");
    return;
  }
  const before = await navigator.storage.persisted();
  const granted = await navigator.storage.persist();
  const estimate = await navigator.storage.estimate();
  const quotaMb = Math.round((estimate.quota ?? 0) / 1024 / 1024);
  log(`V-6: vorher dauerhaft: ${before}, jetzt gewaehrt: ${granted}`);
  log(`V-6: Platz laut Browser: etwa ${quotaMb} MB`);
}

/** 2. Creates a passkey and asks for PRF right away (V-7). */
async function createPasskey() {
  const salt = await prfSalt();
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: "Kopf frei Versuch", id: location.hostname },
      user: {
        id: randomBytes(16),
        name: "versuch",
        displayName: "Kopf frei Versuch",
      },
      challenge: randomBytes(32),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  localStorage.setItem("credentialId", toBase64Url(credential.rawId));
  const prf = credential.getClientExtensionResults().prf;
  log(`V-7: Passkey angelegt. PRF enabled: ${prf?.enabled}`);
  if (prf?.results?.first) {
    const print = await fingerprint(prf.results.first);
    localStorage.setItem("lastPrint", print);
    log(`V-7: PRF schon beim Anlegen, Fingerabdruck ${print}`);
  } else {
    log(
      "V-7: beim Anlegen kein PRF-Wert (das ist erlaubt, Schritt 3 zeigt mehr).",
    );
  }
}

/** 3. Unlocks with the passkey and reads the PRF secret (V-7). */
async function unlock() {
  const id = localStorage.getItem("credentialId");
  if (!id) {
    log("V-7: erst Schritt 2, es gibt noch keinen Passkey.");
    return;
  }
  const salt = await prfSalt();
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: fromBase64Url(id) }],
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const prf = assertion.getClientExtensionResults().prf;
  if (!prf?.results?.first) {
    log("V-7: kein PRF-Wert beim Entsperren.");
    return;
  }
  const print = await fingerprint(prf.results.first);
  const last = localStorage.getItem("lastPrint");
  localStorage.setItem("lastPrint", print);
  log(
    `V-7: PRF-Wert da, ${prf.results.first.byteLength} Bytes, Fingerabdruck ${print}`,
  );
  if (last) {
    log(`V-7: gleich wie beim letzten Mal: ${last === print ? "ja" : "NEIN"}`);
  }
}

/** Runs a step and writes any error to the page. */
function onTap(id, step) {
  document.getElementById(id).addEventListener("click", () => {
    Promise.resolve()
      .then(step)
      .catch((error) => log(`Fehler: ${error.name}: ${error.message}`));
  });
}

onTap("info", showInfo);
onTap("persist", askPersist);
onTap("create", createPasskey);
onTap("unlock", unlock);
onTap("clear", () => {
  logBox.textContent = "";
  localStorage.removeItem("log");
});

// Show what was logged before the last restart.
logBox.textContent = localStorage.getItem("log") ?? "";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .then(() => log("Service Worker registriert."))
    .catch((error) => log(`Service Worker Fehler: ${error.message}`));
}