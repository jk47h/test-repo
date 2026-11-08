// Experiment 2 for phase 2: web push with envelopes that the app
// encrypts itself (V-5, E-096). The computer only sends them on, as
// the server will do later; it never sees the text. Throwaway code,
// plain browser APIs. Uses log, onTap, randomBytes, toBase64Url and
// fromBase64Url from app.js, so this file loads after it.

const encoder = new TextEncoder();
let registration;
let vapidKey;
let subscription;

/** Several byte arrays as one. */
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Text with a zero byte at the end, as RFC 8291 wants it. */
function info(text) {
  return concat(encoder.encode(text), new Uint8Array([0]));
}

/** HKDF with SHA-256: derives `length` bytes from `ikm`. */
async function hkdf(salt, ikm, infoBytes, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: infoBytes },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypts one text for the own push subscription, as one record
 * with content encoding aes128gcm (RFC 8291 and RFC 8188).
 */
async function encrypt(text) {
  const uaPublic = new Uint8Array(subscription.getKey("p256dh"));
  const authSecret = new Uint8Array(subscription.getKey("auth"));
  const curve = { name: "ECDH", namedCurve: "P-256" };

  // A new key pair for every envelope, as RFC 8291 asks.
  const local = await crypto.subtle.generateKey(curve, true, ["deriveBits"]);
  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", local.publicKey),
  );
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    curve,
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaKey },
      local.privateKey,
      256,
    ),
  );

  const keyInfo = concat(info("WebPush: info"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = randomBytes(16);
  const cek = await hkdf(salt, ikm, info("Content-Encoding: aes128gcm"), 16);
  const nonce = await hkdf(salt, ikm, info("Content-Encoding: nonce"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  // 2 marks the last (and only) record, without padding.
  const plaintext = concat(encoder.encode(text), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      plaintext,
    ),
  );

  // Header: salt, record size 4096, length of the key id, key id.
  const recordSize = new Uint8Array([0, 0, 16, 0]);
  const keyIdLength = new Uint8Array([asPublic.length]);
  return concat(salt, recordSize, keyIdLength, asPublic, ciphertext);
}

/** Loads the service worker, the key of the computer and the subscription. */
async function loadPush() {
  registration = await navigator.serviceWorker.ready;
  const response = await fetch("vapid-public.txt", { cache: "no-store" });
  vapidKey = response.ok ? (await response.text()).trim() : undefined;
  subscription = await registration.pushManager.getSubscription();
  const permission =
    "Notification" in window ? Notification.permission : "gibt es nicht";
  log(
    `V-5: push.js geladen, Schluessel vom Rechner: ${vapidKey ? "da" : "FEHLT"}`,
  );
  log(
    `V-5: Abo vorhanden: ${subscription ? "ja" : "nein"}, Erlaubnis: ${permission}`,
  );
}

/** 4. Asks for permission and subscribes. Safari wants a tap for it. */
async function allowPush() {
  if (!registration || !vapidKey) {
    log("V-5: noch nicht bereit, in ein paar Sekunden noch einmal tippen.");
    return;
  }
  if (!subscription) {
    // subscribe comes first, so it still counts as part of the tap.
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(vapidKey),
    });
  }
  log(`V-5: Erlaubnis: ${Notification.permission}`);
  log(`V-5: Abo bei ${new URL(subscription.endpoint).host}`);
  const granted = await navigator.storage.persist();
  log(`V-6 nach der Erlaubnis: dauerhaft gewaehrt: ${granted}`);
}

/** 5. Encrypts three notifications on the iPhone. */
async function buildEnvelopes() {
  if (!subscription) {
    log("V-5: erst Schritt 4, es gibt noch kein Abo.");
    return;
  }
  const time = new Date().toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const messages = [
    { tag: "gezeit", title: "Kopf frei", body: "Heute zählen zwei Dinge." },
    {
      tag: "frist",
      title: "Eine Frist wird knapp",
      body: "Handyvertrag kündigen: muss morgen ankommen.",
    },
    {
      tag: "test",
      title: "Kopf frei Versuch",
      body: `Umschlag 3, verschlüsselt um ${time} auf dem iPhone.`,
    },
  ];
  const envelopes = [];
  for (const message of messages) {
    const sealed = await encrypt(JSON.stringify(message));
    envelopes.push({ name: message.tag, body: toBase64Url(sealed) });
    log(`V-5: Umschlag ${message.tag} gebaut, ${sealed.length} Bytes`);
  }
  const text = JSON.stringify(
    { endpoint: subscription.endpoint, envelopes },
    null,
    2,
  );
  document.getElementById("envelopes").value = text;
}

/** 6. Hands the envelopes to the share sheet, e.g. for a mail to yourself. */
async function shareEnvelopes() {
  const text = document.getElementById("envelopes").value;
  if (!text) {
    log("V-5: erst Schritt 5.");
    return;
  }
  await navigator.share({ text });
  log("V-5: Umschlaege geteilt.");
}

/** Copies the envelopes, if sharing does not fit. */
async function copyEnvelopes() {
  const text = document.getElementById("envelopes").value;
  if (!text) {
    log("V-5: erst Schritt 5.");
    return;
  }
  await navigator.clipboard.writeText(text);
  log("V-5: Umschlaege kopiert.");
}

/** Ends the subscription, e.g. after new keys on the computer. */
async function removeSubscription() {
  if (subscription) {
    await subscription.unsubscribe();
    subscription = undefined;
  }
  log("V-5: Abo geloescht.");
}

onTap("push", allowPush);
onTap("build", buildEnvelopes);
onTap("share", shareEnvelopes);
onTap("copy", copyEnvelopes);
onTap("unsubscribe", removeSubscription);

if ("serviceWorker" in navigator && "PushManager" in window) {
  loadPush().catch((error) =>
    log(`V-5 Fehler: ${error.name}: ${error.message}`),
  );
} else {
  log("V-5: Web Push gibt es hier nicht (nur vom Home-Bildschirm).");
}