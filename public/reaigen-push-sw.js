"use strict";

function safeDestination(data) {
  if (!data || typeof data !== "object") return "/dashboard";
  const path = typeof data.web_path === "string" ? data.web_path : "";
  if (/^\/(?:dashboard|draft\/\d+|tour\/\d+|tours)(?:[/?#].*)?$/.test(path)) {
    return path;
  }
  const draftId = Number(data.draft_id);
  if (Number.isSafeInteger(draftId) && draftId > 0) {
    return `/draft/${draftId}`;
  }
  const splatId = Number(data.splat_id);
  if (Number.isSafeInteger(splatId) && splatId > 0) {
    return `/tour/${splatId}`;
  }
  return "/dashboard";
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string"
    ? payload.title.slice(0, 180)
    : "Reaigen";
  const body = typeof payload.body === "string"
    ? payload.body.slice(0, 500)
    : "There is an update in your workspace.";
  const tag = typeof payload.collapse_key === "string"
    ? `reaigen:${payload.collapse_key.slice(0, 120)}`
    : "reaigen:update";

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    renotify: false,
    data: { destination: safeDestination(payload.data) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = safeDestination({
    web_path: event.notification.data?.destination,
  });
  const target = new URL(destination, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.navigate(target);
      return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
