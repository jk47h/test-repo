// Minimal service worker. It does nothing yet, but the page needs one
// later for push (V-5), and it lets us see that registering works.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});