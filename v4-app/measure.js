// Experiment 4 (V-8, V-9): measures encryption and storage in the
// browser. V-8 compares libsodium as WebAssembly with the pure
// JavaScript of noble; V-9 compares IndexedDB with SQLite as
// WebAssembly (expo-sqlite). Throwaway code.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2id } from "@noble/hashes/argon2.js";
import * as SQLite from "expo-sqlite";
import sodium from "libsodium-wrappers-sumo";

const RECORDS = 2000;
const SINGLE_WRITES = 50;
const KEY_ITEM = "kf-versuch-key";
const RUNNING_ITEM = "kf-versuch-running";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Waits a moment, so the screen can show the last log line. */
function pause() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/** Runs fn and returns its result and the time it took in ms. */
async function timed(fn) {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

/** A record about the size of a real entry, as JSON. */
function sampleEntry(index) {
  return JSON.stringify({
    id: `e-${index}`,
    title: `Eintrag Nummer ${index} mit Umlauten äöü`,
    kind: "task",
    zone: "soon",
    dueDate: "2026-11-20",
    duration: 30,
    notes: "Ein kurzer Text, wie er bei vielen Einträgen steht.",
    fieldTimes: { title: 1762700000000 + index, zone: 1762700000000 },
  });
}

/** Encrypts one text: 24 bytes nonce, then the ciphertext. */
function seal(key, text) {
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const box = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    text,
    null,
    null,
    nonce,
    key,
  );
  const data = new Uint8Array(nonce.length + box.length);
  data.set(nonce);
  data.set(box, nonce.length);
  return data;
}

/** Opens what seal made; throws if the data was changed. */
function open(key, data) {
  const nonce = data.subarray(0, 24);
  const box = data.subarray(24);
  return decoder.decode(
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      box,
      null,
      nonce,
      key,
    ),
  );
}

/** All test records, encrypted. Only id and version stay readable. */
function makeRecords(key) {
  const records = [];
  for (let index = 0; index < RECORDS; index += 1) {
    records.push({
      id: `e-${index}`,
      version: 1,
      data: seal(key, sampleEntry(index)),
    });
  }
  return records;
}

/** Decrypts all records and counts how many open correctly. */
function openAll(key, records) {
  let good = 0;
  for (const record of records) {
    try {
      JSON.parse(open(key, new Uint8Array(record.data)));
      good += 1;
    } catch {
      // Counted as broken.
    }
  }
  return good;
}

/** The key of the test data; kept in localStorage for this test only. */
function storedKey() {
  const hex = localStorage.getItem(KEY_ITEM);
  return hex ? sodium.from_hex(hex) : null;
}

// ---------- V-8: encryption ----------

/** Measures Argon2id and XChaCha20-Poly1305 with both libraries. */
export async function measureCrypto(log) {
  await sodium.ready;
  log(`libsodium ${sodium.sodium_version_string()} geladen`);
  const salt = sodium.randombytes_buf(16);
  const password = "ein Beispielpasswort";

  // The OWASP minimum first, then more memory each time.
  const settings = [
    { t: 2, mib: 19 },
    { t: 3, mib: 64 },
    { t: 3, mib: 128 },
    { t: 3, mib: 256 },
  ];
  let reference;
  for (const { t, mib } of settings) {
    const label = `Argon2id t=${t}, ${mib} MiB`;
    // If the page crashes here, the next start shows where.
    localStorage.setItem(RUNNING_ITEM, label);
    log(`${label}: läuft …`);
    await pause();
    const { result, ms } = await timed(() =>
      sodium.crypto_pwhash(
        32,
        password,
        salt,
        t,
        mib * 1024 * 1024,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      ),
    );
    if (mib === 19) {
      reference = result;
    }
    log(`${label}, libsodium: ${ms} ms`);
  }
  localStorage.removeItem(RUNNING_ITEM);

  log("Argon2id t=2, 19 MiB, noble: läuft …");
  await pause();
  const noble = await timed(() =>
    argon2id(password, salt, { t: 2, m: 19 * 1024, p: 1, dkLen: 32 }),
  );
  const same = sodium.to_hex(noble.result) === sodium.to_hex(reference);
  log(
    `Argon2id t=2, 19 MiB, noble: ${noble.ms} ms, gleiches Ergebnis: ${same ? "ja" : "NEIN"}`,
  );
  await pause();

  const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
  const texts = [];
  for (let index = 0; index < RECORDS; index += 1) {
    texts.push(sampleEntry(index));
  }
  const sealed = await timed(() => texts.map((text) => seal(key, text)));
  const opened = await timed(() =>
    sealed.result.map((data) => open(key, data)),
  );
  log(
    `${RECORDS} Datensätze, libsodium: verschlüsseln ${sealed.ms} ms, entschlüsseln ${opened.ms} ms`,
  );
  await pause();

  const nobleSealed = await timed(() =>
    texts.map((text) => {
      const nonce = sodium.randombytes_buf(24);
      return {
        nonce,
        box: xchacha20poly1305(key, nonce).encrypt(encoder.encode(text)),
      };
    }),
  );
  const nobleOpened = await timed(() =>
    nobleSealed.result.map(({ nonce, box }) =>
      xchacha20poly1305(key, nonce).decrypt(box),
    ),
  );
  log(
    `${RECORDS} Datensätze, noble: verschlüsseln ${nobleSealed.ms} ms, entschlüsseln ${nobleOpened.ms} ms`,
  );
  // Both libraries must read each other's data.
  const cross =
    open(key, sealed.result[0]) ===
    decoder.decode(
      xchacha20poly1305(key, sealed.result[0].subarray(0, 24)).decrypt(
        sealed.result[0].subarray(24),
      ),
    );
  log(`libsodium und noble lesen dieselben Daten: ${cross ? "ja" : "NEIN"}`);
}

/** Tells, after a start, whether the last Argon2id run crashed. */
export function crashNote() {
  const label = localStorage.getItem(RUNNING_ITEM);
  localStorage.removeItem(RUNNING_ITEM);
  return label ? `Letzter Lauf brach ab bei: ${label}` : null;
}

// ---------- V-9: storage ----------

/** Wraps an IndexedDB request in a promise. */
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Waits until a transaction is written. */
function finished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const indexedDb = {
  name: "IndexedDB",
  async open() {
    const request = indexedDB.open("kf-versuch", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("records", { keyPath: "id" });
    this.db = await done(request);
  },
  async clear() {
    const transaction = this.db.transaction("records", "readwrite");
    transaction.objectStore("records").clear();
    await finished(transaction);
  },
  async writeAll(records) {
    const transaction = this.db.transaction("records", "readwrite");
    const store = transaction.objectStore("records");
    for (const record of records) {
      store.put(record);
    }
    await finished(transaction);
  },
  async writeOne(record) {
    const transaction = this.db.transaction("records", "readwrite");
    transaction.objectStore("records").put(record);
    await finished(transaction);
  },
  async readAll() {
    const transaction = this.db.transaction("records", "readonly");
    return done(transaction.objectStore("records").getAll());
  },
};

// The database is opened once and shared by both SQLite variants.
let database;

/**
 * SQLite as WebAssembly (expo-sqlite). With asText, the encrypted
 * data is stored as base64 text instead of bytes (BLOB).
 */
function sqliteStore(asText) {
  const table = asText ? "records_text" : "records_blob";
  const insert = `INSERT OR REPLACE INTO ${table} (id, version, data) VALUES (?, ?, ?)`;
  const pack = (data) => (asText ? sodium.to_base64(data) : data);
  return {
    name: asText ? "SQLite Text" : "SQLite BLOB",
    async open() {
      database ??= await SQLite.openDatabaseAsync("kf-versuch.db");
      await database.execAsync(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL, data ${asText ? "TEXT" : "BLOB"} NOT NULL)`,
      );
    },
    async clear() {
      await database.runAsync(`DELETE FROM ${table}`);
    },
    async writeAll(records) {
      await database.withTransactionAsync(async () => {
        const statement = await database.prepareAsync(insert);
        try {
          for (const record of records) {
            await statement.executeAsync([
              record.id,
              record.version,
              pack(record.data),
            ]);
          }
        } finally {
          await statement.finalizeAsync();
        }
      });
    },
    async writeOne(record) {
      await database.runAsync(insert, [
        record.id,
        record.version,
        pack(record.data),
      ]);
    },
    async readAll() {
      const rows = await database.getAllAsync(
        `SELECT id, version, data FROM ${table}`,
      );
      return asText
        ? rows.map((row) => ({ ...row, data: sodium.from_base64(row.data) }))
        : rows;
    },
  };
}

const stores = [indexedDb, sqliteStore(false), sqliteStore(true)];

/** Space used by the page, as the browser tells it. */
async function usage(log) {
  const estimate = await navigator.storage.estimate();
  log(`Speicher belegt: ${(estimate.usage / 1024 / 1024).toFixed(1)} MB`);
}

/** Writes and reads the same records in all three stores. */
export async function measureStorage(log) {
  await sodium.ready;
  const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
  localStorage.setItem(KEY_ITEM, sodium.to_hex(key));
  const records = makeRecords(key);
  log(`${RECORDS} verschlüsselte Datensätze vorbereitet`);
  await usage(log);
  for (const store of stores) {
    try {
      const opening = await timed(() => store.open());
      await store.clear();
      log(`${store.name}: geöffnet in ${opening.ms} ms`);
      await pause();
      const all = await timed(() => store.writeAll(records));
      log(`${store.name}: ${RECORDS} schreiben ${all.ms} ms`);
      await pause();
      const single = await timed(async () => {
        for (let index = 0; index < SINGLE_WRITES; index += 1) {
          const record = records[index];
          await store.writeOne({ ...record, version: 2 });
        }
      });
      log(
        `${store.name}: einzeln schreiben im Schnitt ${(single.ms / SINGLE_WRITES).toFixed(1)} ms`,
      );
      await pause();
      const read = await timed(async () => openAll(key, await store.readAll()));
      log(
        `${store.name}: alle lesen und entschlüsseln ${read.ms} ms, ${read.result} von ${RECORDS} in Ordnung`,
      );
    } catch (error) {
      log(`${store.name} Fehler: ${error.name}: ${error.message}`);
    }
    await pause();
  }
  await usage(log);
}

/** After a restart of the app: is everything still there? */
export async function readAgain(log) {
  await sodium.ready;
  const key = storedKey();
  if (!key) {
    log("Noch keine Testdaten, erst Knopf 2.");
    return;
  }
  for (const store of stores) {
    try {
      const opening = await timed(() => store.open());
      const read = await timed(async () => openAll(key, await store.readAll()));
      log(
        `${store.name}: geöffnet in ${opening.ms} ms, gelesen in ${read.ms} ms, ${read.result} von ${RECORDS} in Ordnung`,
      );
    } catch (error) {
      log(`${store.name} Fehler: ${error.name}: ${error.message}`);
    }
    await pause();
  }
  await usage(log);
}