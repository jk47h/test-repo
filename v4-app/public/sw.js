// Experiment 3 (V-4, W-09): a service worker that holds on to one
// confirmed version of the app. A new version on the server only
// becomes active after a tap in the app. Throwaway code.

const META = "kf-meta";
const APP_PREFIX = "kf-app-";

/** URL of a file next to this service worker. */
function inScope(path) {
  return new URL(path, self.registration.scope).href;
}

/** The newest version on the server, read past every cache. */
async function latestVersion() {
  const response = await fetch(inScope("version.json"), { cache: "no-store" });
  return response.json();
}

/** The confirmed version, or null before the first install. */
async function confirmedVersion() {
  const meta = await caches.open(META);
  const entry = await meta.match("confirmed");
  return entry ? entry.text() : null;
}

/** Loads all files of a version and makes it the confirmed one. */
async function confirm(info) {
  const cache = await caches.open(APP_PREFIX + info.version);
  // "reload" skips the HTTP cache, which may still hold an old index.html.
  const requests = info.files.map(
    (file) => new Request(inScope(file), { cache: "reload" }),
  );
  await cache.addAll(requests);
  const meta = await caches.open(META);
  await meta.put("confirmed", new Response(info.version));
  // Old versions are no longer needed.
  for (const name of await caches.keys()) {
    if (name.startsWith(APP_PREFIX) && name !== APP_PREFIX + info.version) {
      await caches.delete(name);
    }
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Only the very first install confirms a version by itself.
  event.waitUntil(
    confirmedVersion().then(async (version) => {
      if (!version) {
        await confirm(await latestVersion());
      }
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const ownFile = url.href.startsWith(self.registration.scope);
  if (event.request.method !== "GET" || !ownFile) {
    return;
  }
  if (url.pathname.endsWith("/version.json")) {
    return; // Always from the network.
  }
  event.respondWith(
    (async () => {
      const version = await confirmedVersion();
      if (version) {
        const cache = await caches.open(APP_PREFIX + version);
        // Every page of the app is the one index.html.
        const key =
          event.request.mode === "navigate"
            ? inScope("index.html")
            : event.request;
        const hit = await cache.match(key, { ignoreSearch: true });
        if (hit) {
          return hit;
        }
      }
      return fetch(event.request);
    })(),
  );
});

self.addEventListener("message", (event) => {
  const port = event.ports[0];
  const answer = async () => {
    if (event.data.type === "which") {
      return { confirmed: await confirmedVersion() };
    }
    if (event.data.type === "activate") {
      const info = await latestVersion();
      if (info.version !== event.data.version) {
        return {
          error: "Auf dem Server liegt inzwischen eine andere Version.",
        };
      }
      await confirm(info);
      return { confirmed: info.version };
    }
    return { error: "unbekannt" };
  };
  event.waitUntil(
    answer()
      .catch((error) => ({ error: error.message }))
      .then((result) => port.postMessage(result)),
  );
});