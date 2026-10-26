self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "家庭管家";
  const options = {
    body: data.body || "有新的家庭待办需要处理。",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "family-note",
    renotify: true,
    data: { url: data.url || "/tasks" },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      typeof self.navigator.setAppBadge === "function"
        ? self.navigator.setAppBadge(Number(data.badgeCount) || 0)
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/tasks", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
