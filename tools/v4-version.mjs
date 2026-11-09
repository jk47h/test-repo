// Experiment 3 (V-4): runs after "expo export". It copies the build
// from v4-app/dist to v4, where GitHub Pages serves it, and writes
// v4/version.json. That lists every file of the build and names the
// version after a checksum over all of them (W-04), so each build
// with a change gets a new version by itself.

import { createHash } from "node:crypto";
import {
  cpSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../v4-app/dist/", import.meta.url));
const root = fileURLToPath(new URL("../v4/", import.meta.url));
// The service worker and this file are not part of a version.
const skip = new Set(["sw.js", "version.json"]);

/** All files below a folder, as paths with "/" like in a URL. */
function listFiles(folder) {
  const files = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
    } else {
      files.push(relative(root, path).split(sep).join("/"));
    }
  }
  return files;
}

// Expo does not write outside its project, so the build is copied.
rmSync(root, { recursive: true, force: true });
cpSync(dist, root, { recursive: true });

const files = listFiles(root)
  .filter((file) => !skip.has(file))
  .sort();
const hash = createHash("sha256");
for (const file of files) {
  hash.update(file);
  hash.update(readFileSync(join(root, file)));
}
const version = hash.digest("hex").slice(0, 12);
writeFileSync(
  join(root, "version.json"),
  JSON.stringify({ version, files }, null, 2) + "\n",
);
console.log(`Version ${version} mit ${files.length} Dateien`);