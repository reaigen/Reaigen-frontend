"use client";

import { useReportWebVitals } from "next/web-vitals";

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    const payload = JSON.stringify({
      id: metric.id,
      name: metric.name,
      value: metric.value,
      delta: metric.delta,
      rating: metric.rating,
      navigationType: metric.navigationType,
    });

    if (process.env.NODE_ENV === "development") {
      console.debug("[web-vitals]", payload);
    }

    const endpoint = process.env.NEXT_PUBLIC_WEB_VITALS_ENDPOINT;
    if (!endpoint) return;

    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
      if (sent) return;
    }

    fetch(endpoint, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  });

  return null;
}
