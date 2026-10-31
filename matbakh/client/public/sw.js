const CACHE_NAME = "matbakh-shell-v1";

self.addEventListener("install", event => {
  // Deliberately do not cache application HTML or private API responses.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || "" }; }
  const title = data.title || "مطبخي";
  const options = {
    body: data.body || "لديك إشعار جديد.",
    tag: data.notificationId ? `matbakh-${data.notificationId}` : "matbakh-notification",
    renotify: false,
    dir: "rtl",
    lang: "ar",
    icon: "/icons/notification-192.png",
    badge: "/icons/notification-96.png",
    data: { url: data.url || "/notifications", notificationId: data.notificationId },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "/notifications";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const existing = list.find(client => "focus" in client);
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  }));
});
