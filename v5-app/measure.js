// Experiment 5 (V-1, V-8): measures in the Android app on the A12.
// V-1: does expo-sqlite really encrypt with SQLCipher, with the key
// in the secure storage of the phone? V-8: how fast are Argon2id and
// XChaCha20-Poly1305 natively, with react-native-libsodium and with
// react-native-quick-crypto? Throwaway code.

import { File } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import {
  crypto_aead_xchacha20poly1305_ietf_decrypt,
  crypto_aead_xchacha20poly1305_ietf_encrypt,
  crypto_pwhash,
  crypto_pwhash_ALG_ARGON2ID13,
  randombytes_buf,
  to_hex,
} from "react-native-libsodium";
import { argon2Sync } from "react-native-quick-crypto";

const RECORDS = 2000;
const SINGLE_WRITES = 50;
const DB_NAME = "kf-versuch.db";
const DB_KEY_ITEM = "kf-db-key";
const RECORD_KEY_ITEM = "kf-record-key";
const MIB = 1024 * 1024;

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

/** Hex text as bytes. */
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
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
  const nonce = randombytes_buf(24);
  const box = crypto_aead_xchacha20poly1305_ietf_encrypt(
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
  return crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    data.subarray(24),
    null,
    data.subarray(0, 24),
    key,
    "text",
  );
}

/** Decrypts all records and counts how many open correctly. */
function openAll(key, rows) {
  let good = 0;
  for (const row of rows) {
    try {
      JSON.parse(open(key, new Uint8Array(row.data)));
      good += 1;
    } catch {
      // Counted as broken.
    }
  }
  return good;
}

// ---------- V-8: encryption ----------

/** Measures Argon2id and XChaCha20-Poly1305 natively. */
export async function measureCrypto(log) {
  const salt = randombytes_buf(16);
  const password = "ein Beispielpasswort";

  // J, 10.11.2026: at least 128 MiB. The other steps are for comparison.
  const settings = [
    { t: 2, mib: 19 },
    { t: 3, mib: 64 },
    { t: 2, mib: 128 },
    { t: 3, mib: 128 },
    { t: 4, mib: 128 },
    { t: 3, mib: 256 },
  ];
  let reference;
  for (const { t, mib } of settings) {
    const label = `Argon2id t=${t}, ${mib} MiB`;
    log(`${label}, libsodium: läuft …`);
    await pause();
    const { result, ms } = await timed(() =>
      crypto_pwhash(
        32,
        password,
        salt,
        t,
        mib * MIB,
        crypto_pwhash_ALG_ARGON2ID13,
      ),
    );
    if (t === 3 && mib === 128) {
      reference = result;
    }
    log(`${label}, libsodium: ${ms} ms`);
  }

  // quick-crypto uses OpenSSL; with p=4 it may work on four lanes.
  for (const lanes of [1, 4]) {
    const label = `Argon2id t=3, 128 MiB, p=${lanes}, quick-crypto`;
    log(`${label}: läuft …`);
    await pause();
    try {
      const { result, ms } = await timed(() =>
        argon2Sync("argon2id", {
          message: password,
          nonce: salt,
          parallelism: lanes,
          tagLength: 32,
          memory: 128 * 1024,
          passes: 3,
        }),
      );
      const same =
        lanes === 1
          ? `, gleiches Ergebnis wie libsodium: ${to_hex(new Uint8Array(result)) === to_hex(reference) ? "ja" : "NEIN"}`
          : "";
      log(`${label}: ${ms} ms${same}`);
    } catch (error) {
      log(`${label} Fehler: ${error.name}: ${error.message}`);
    }
  }
  await pause();

  const key = randombytes_buf(32);
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
}

// ---------- V-1: SQLCipher ----------

/** The keys from the secure storage; made on the first run of button 2. */
async function keys(log, create) {
  let dbKey = await SecureStore.getItemAsync(DB_KEY_ITEM);
  let recordKey = await SecureStore.getItemAsync(RECORD_KEY_ITEM);
  if (!dbKey || !recordKey) {
    if (!create) {
      return null;
    }
    dbKey = to_hex(randombytes_buf(32));
    recordKey = to_hex(randombytes_buf(32));
    await SecureStore.setItemAsync(DB_KEY_ITEM, dbKey);
    await SecureStore.setItemAsync(RECORD_KEY_ITEM, recordKey);
    log("Neue Schlüssel im sicheren Speicher abgelegt");
  } else {
    log("Schlüssel aus dem sicheren Speicher gelesen");
  }
  return { dbKey, recordKey: fromHex(recordKey) };
}

/** Opens the database with a raw 32 byte key, as SQLCipher wants it. */
async function openDatabase(dbKey) {
  const db = await SQLite.openDatabaseAsync(DB_NAME, {
    useNewConnection: true,
  });
  await db.execAsync(`PRAGMA key = "x'${dbKey}'"`);
  return db;
}

/** SQLCipher answers with its version; plain SQLite answers nothing. */
async function cipherVersion(db, log) {
  const row = await db.getFirstAsync("PRAGMA cipher_version");
  const version = row ? Object.values(row)[0] : null;
  log(
    `SQLCipher-Version: ${version ?? "KEINE, die Datenbank wäre unverschlüsselt"}`,
  );
  return version;
}

/** The first 16 bytes of the file; plain SQLite starts with "SQLite format 3". */
function fileHeader(db, log) {
  const path = db.databasePath;
  const uri = path.startsWith("file://") ? path : `file://${path}`;
  const handle = new File(uri).open();
  try {
    const bytes = handle.readBytesSync(16);
    const text = String.fromCharCode(...bytes.subarray(0, 15));
    const plain = text === "SQLite format 3";
    log(
      `Dateianfang: ${plain ? "SQLite format 3, also UNVERSCHLÜSSELT" : "nicht lesbar, also verschlüsselt"}`,
    );
  } finally {
    handle.close();
  }
}

/** Tries to read the database with a wrong key; that has to fail. */
async function wrongKey(log) {
  const db = await openDatabase(to_hex(randombytes_buf(32)));
  try {
    await db.getFirstAsync("SELECT count(*) AS n FROM records");
    log("Falscher Schlüssel: konnte lesen, das wäre FALSCH");
  } catch (error) {
    log(`Falscher Schlüssel: abgelehnt (${error.message})`);
  } finally {
    await db.closeAsync();
  }
}

/** Writes and reads the records in the encrypted database. */
export async function measureDatabase(log) {
  const { dbKey, recordKey } = await keys(log, true);
  const opening = await timed(() => openDatabase(dbKey));
  const db = opening.result;
  log(`Datenbank geöffnet in ${opening.ms} ms`);
  if (!(await cipherVersion(db, log))) {
    await db.closeAsync();
    return;
  }
  await db.execAsync(
    "CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL, data BLOB NOT NULL); DELETE FROM records;",
  );
  const records = [];
  for (let index = 0; index < RECORDS; index += 1) {
    records.push({
      id: `e-${index}`,
      version: 1,
      data: seal(recordKey, sampleEntry(index)),
    });
  }
  const insert =
    "INSERT OR REPLACE INTO records (id, version, data) VALUES (?, ?, ?)";
  const all = await timed(() =>
    db.withTransactionAsync(async () => {
      const statement = await db.prepareAsync(insert);
      try {
        for (const record of records) {
          await statement.executeAsync([
            record.id,
            record.version,
            record.data,
          ]);
        }
      } finally {
        await statement.finalizeAsync();
      }
    }),
  );
  log(`${RECORDS} schreiben ${all.ms} ms`);
  await pause();
  const single = await timed(async () => {
    for (let index = 0; index < SINGLE_WRITES; index += 1) {
      const record = records[index];
      await db.runAsync(insert, [record.id, 2, record.data]);
    }
  });
  log(
    `einzeln schreiben im Schnitt ${(single.ms / SINGLE_WRITES).toFixed(1)} ms`,
  );
  await pause();
  const read = await timed(async () =>
    openAll(
      recordKey,
      await db.getAllAsync("SELECT id, version, data FROM records"),
    ),
  );
  log(
    `alle lesen und entschlüsseln ${read.ms} ms, ${read.result} von ${RECORDS} in Ordnung`,
  );
  fileHeader(db, log);
  await db.closeAsync();
  await wrongKey(log);
}

/** After a restart of the app: keys and data still there? */
export async function readAgain(log) {
  const found = await keys(log, false);
  if (!found) {
    log("Noch keine Schlüssel, erst Knopf 2.");
    return;
  }
  const { dbKey, recordKey } = found;
  const opening = await timed(() => openDatabase(dbKey));
  const db = opening.result;
  try {
    await cipherVersion(db, log);
    const read = await timed(async () =>
      openAll(
        recordKey,
        await db.getAllAsync("SELECT id, version, data FROM records"),
      ),
    );
    log(
      `geöffnet in ${opening.ms} ms, gelesen in ${read.ms} ms, ${read.result} von ${RECORDS} in Ordnung`,
    );
  } finally {
    await db.closeAsync();
  }
}