import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

function contentSecurityPolicy({ googleMaps = false } = {}) {
  // The SparkJS splat decoder ships its WebAssembly inlined as a data: URL and
  // instantiates it inside a blob worker. 'wasm-unsafe-eval' is the narrow
  // token for that — it permits WebAssembly compilation without granting
  // 'unsafe-eval' to JavaScript — and connect-src needs data:/blob: so the
  // worker can fetch the module it was bundled with.
  const scriptSrc = ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"];
  const connectSrc = ["'self'", "https:", "data:", "blob:"];

  if (!isProduction) {
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push("http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*");
  }

  // The authenticated property location card uses the Google Maps JavaScript
  // API. Keep its script/eval allowances on draft pages instead of widening
  // the CSP for the public viewer and the rest of the application.
  if (googleMaps) {
    if (!scriptSrc.includes("'unsafe-eval'")) scriptSrc.push("'unsafe-eval'");
    scriptSrc.push(
      "https://*.googleapis.com",
      "https://*.gstatic.com",
      "https://*.google.com",
      "https://*.ggpht.com",
      "https://*.googleusercontent.com",
      "blob:",
    );
  }

  const directives = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'", ...(googleMaps ? ["https://fonts.googleapis.com"] : [])]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:", ...(googleMaps ? ["https://fonts.gstatic.com"] : [])]],
    ["connect-src", connectSrc],
    ["media-src", ["'self'", "blob:", "https:"]],
    ["worker-src", ["'self'", "blob:"]],
    ["child-src", ["'self'", "blob:"]],
    ["frame-src", ["'self'", ...(googleMaps ? ["https://*.google.com"] : [])]],
    ["manifest-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'self'"]],
    ["object-src", ["'none'"]],
  ];

  if (isProduction) directives.push(["upgrade-insecure-requests", []]);

  return directives.map(([key, values]) => [key, ...(values as string[])].join(" ")).join("; ");
}

function securityHeaders({ googleMaps = false } = {}) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "Referrer-Policy", value: googleMaps ? "strict-origin-when-cross-origin" : "no-referrer" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ googleMaps }) },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), browsing-topics=()" },
    ...(isProduction
      ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
      : []),
  ];
}

const defaultSecurityHeaders = securityHeaders();
const googleMapsSecurityHeaders = securityHeaders({ googleMaps: true });

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  skipTrailingSlashRedirect: true,
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0", "100.115.47.42", "100.78.1.23", "app-reaigen.publicrouter.sk"],
  async headers() {
    return [
      ...[
        "/apple-app-site-association",
        "/.well-known/apple-app-site-association",
      ].map((source) => ({
        source,
        headers: [
          ...defaultSecurityHeaders,
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
        ],
      })),
      {
        // Header rules are resolved in declaration order. Keep this before the
        // catch-all so draft responses retain the Google Maps CSP instead of
        // inheriting the stricter default policy first.
        source: "/draft/:path*",
        headers: [
          ...googleMapsSecurityHeaders,
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        // Authenticated app routes can render Google map blocks in the Agent.
        // Exclude all of them here so this default CSP cannot overwrite their
        // Google-compatible policy through a second matching header rule.
        source: "/:path((?!(?:draft|dashboard|tour|tours|shares|settings|create)(?:/|$)).*)",
        headers: defaultSecurityHeaders,
      },
      {
        // Media previews set status-aware cache headers in their route handler.
        // Excluding them here keeps successful bytes reusable without caching
        // authentication or upstream error responses.
        source: "/api/:path((?!media-proxy$).*)",
        headers: [
          ...defaultSecurityHeaders,
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        // Authenticated SOGs are immutable by fingerprint (`?v=`). Let the
        // browser retain range responses while keeping them private to the
        // signed-in session; the general API no-store rule above otherwise
        // forces every viewer/editor transition to fetch the scene again.
        source: "/api/sog/:path*",
        headers: [
          ...defaultSecurityHeaders,
          { key: "Cache-Control", value: "private, max-age=3600" },
        ],
      },
      ...[
        "/",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
      ].map((source) => ({
        source,
        headers: [
          ...defaultSecurityHeaders,
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      })),
      ...[
        "/dashboard/:path*",
        "/tour/:path*",
        "/tours/:path*",
        "/shares/:path*",
        "/settings/:path*",
        "/create/:path*",
      ].map((source) => ({
        source,
        headers: [
          ...googleMapsSecurityHeaders,
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      })),
    ];
  },
};

export default nextConfig;
