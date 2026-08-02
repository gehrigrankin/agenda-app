/*
 * Service worker for the Agenda PWA. Deliberately minimal and dependency-free:
 *
 * - No offline caching strategy. The app is server-rendered and auth-gated, so
 *   an aggressive cache creates stale/permission bugs for no real win. The
 *   fetch handler below is a pure passthrough (it never calls respondWith), so
 *   every request behaves exactly as it would without a service worker — its
 *   presence just satisfies PWA installability checks.
 * - Push handlers for web push (the push subscription work lands separately):
 *   the payload contract is a JSON object { title, body, url, tag? }.
 *
 * Registered by src/components/pwa/ServiceWorkerRegistration.tsx.
 */

self.addEventListener("install", () => {
  // Activate a new version immediately; there is no cache to migrate.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Control already-open pages so push subscriptions work without a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally empty: passthrough. Do not add respondWith here without a
  // deliberate caching design — see the header comment.
});

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    // Non-JSON payload — show whatever text we got rather than nothing.
    payload = { title: "Agenda", body: event.data ? event.data.text() : "" };
  }
  if (!payload || !payload.title) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || undefined,
      // Carried through to notificationclick below.
      data: { url: payload.url || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // Prefer focusing an existing app window (navigating it to the target)
        // over spawning a new one.
        for (const client of windows) {
          if ("focus" in client) {
            if ("navigate" in client) client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
