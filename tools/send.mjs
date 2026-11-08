// Experiment 2 (V-5) on the computer: plays the server. It makes the
// VAPID keys and sends the envelopes that the iPhone encrypted itself
// to Apple's push service. It never sees the text. Needs Node 18 or
// newer and no packages.
//
//   node tools/send.mjs schluessel
//   node tools/send.mjs senden tools/geheim/umschlaege.json [minuten]

import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const secretDir = fileURLToPath(new URL("geheim/", import.meta.url));
const keyFile = fileURLToPath(new URL("geheim/vapid.json", import.meta.url));
const publicFile = fileURLToPath(
  new URL("../iphone/vapid-public.txt", import.meta.url),
);
// Who runs the sender; Apple wants a URL or a mailto address here.
const contact = "https://jk47h.github.io/test-repo/";

/** Object as base64url JSON, for the parts of the JWT. */
function base64Json(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** The public key as 65 raw bytes in base64url, as the browser wants it. */
function rawPublicKey(jwk) {
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  return Buffer.concat([Buffer.from([4]), x, y]).toString("base64url");
}

/** Makes a new key pair; the private key stays in tools/geheim. */
function makeKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  mkdirSync(secretDir, { recursive: true });
  writeFileSync(keyFile, JSON.stringify(jwk, null, 2) + "\n");
  writeFileSync(publicFile, rawPublicKey(jwk) + "\n");
  console.log(`Privater Schluessel: ${keyFile} (nie committen)`);
  console.log(`Oeffentlicher Schluessel: ${publicFile} (committen)`);
}

/** The VAPID header (RFC 8292): a JWT signed with ES256. */
function vapidHeader(endpoint, jwk) {
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: new URL(endpoint).origin,
    // Apple accepts at most one day; 12 hours is enough.
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: contact,
  };
  const unsigned = `${base64Json(header)}.${base64Json(claims)}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey({ key: jwk, format: "jwk" }),
    dsaEncoding: "ieee-p1363",
  });
  const token = `${unsigned}.${signature.toString("base64url")}`;
  return `vapid t=${token}, k=${rawPublicKey(jwk)}`;
}

/** Waits the given number of milliseconds. */
function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Sends all envelopes of the file, after an optional wait. */
async function sendAll(file, minutes) {
  const jwk = JSON.parse(readFileSync(keyFile, "utf8"));
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (minutes > 0) {
    console.log(`Warte ${minutes} Minuten. Jetzt die App schliessen.`);
    await wait(minutes * 60 * 1000);
  }
  for (const envelope of data.envelopes) {
    const response = await fetch(data.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidHeader(data.endpoint, jwk),
        TTL: "3600",
        Urgency: "normal",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
      },
      body: Buffer.from(envelope.body, "base64url"),
    });
    const time = new Date().toLocaleTimeString("de-DE");
    const answer = await response.text();
    console.log(`${time}  ${envelope.name}: ${response.status} ${answer}`);
    // A short gap, so the notifications come one after another.
    await wait(5000);
  }
}

const [command, file, minutes] = process.argv.slice(2);
if (command === "schluessel") {
  makeKeys();
} else if (command === "senden" && file) {
  await sendAll(file, Number(minutes ?? 0));
} else {
  console.log("node tools/send.mjs schluessel");
  console.log(
    "node tools/send.mjs senden tools/geheim/umschlaege.json [minuten]",
  );
}