// Service worker of the experiments. Experiment 2 (V-5) shows every
// push as a notification. Safari demands that each push shows one,
// so there is a fallback text if the content cannot be read.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let message = {
    tag: "leer",
    title: "Kopf frei Versuch",
    body: "Push ohne lesbaren Inhalt.",
  };
  try {
    message = event.data.json();
  } catch {
    // Keep the fallback; the notification has to come anyway.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("./"));
});