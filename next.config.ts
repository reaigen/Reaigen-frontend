import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

function contentSecurityPolicy() {
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

  const directives = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connectSrc],
    ["media-src", ["'self'", "blob:", "https:"]],
    ["worker-src", ["'self'", "blob:"]],
    ["child-src", ["'self'", "blob:"]],
    ["frame-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'self'"]],
    ["object-src", ["'none'"]],
  ];

  if (isProduction) directives.push(["upgrade-insecure-requests", []]);

  return directives.map(([key, values]) => [key, ...(values as string[])].join(" ")).join("; ");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), browsing-topics=()" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

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
          ...securityHeaders,
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
        ],
      })),
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Media previews and private map images set status-aware cache headers
        // in their route handlers. Excluding them here keeps successful bytes
        // reusable without accidentally caching an authentication or upstream
        // error response.
        source: "/api/:path((?!media-proxy$|maps/static$).*)",
        headers: [
          ...securityHeaders,
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
          ...securityHeaders,
          { key: "Cache-Control", value: "private, max-age=3600" },
        ],
      },
      ...[
        "/",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
        "/dashboard/:path*",
        "/draft/:path*",
        "/tour/:path*",
        "/tours/:path*",
        "/shares/:path*",
        "/settings/:path*",
        "/create/:path*",
      ].map((source) => ({
        source,
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      })),
    ];
  },
};

export default nextConfig;
