import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "./components/hooks/use-auth";
import { WebVitalsReporter } from "./components/web-vitals-reporter";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

function metadataBase() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://app-reaigen.publicrouter.sk");
  } catch {
    return new URL("https://app-reaigen.publicrouter.sk");
  }
}

export const metadata: Metadata = {
  metadataBase: metadataBase(),
  applicationName: "Reaigen",
  title: {
    default: "Reaigen",
    template: "%s | Reaigen",
  },
  description: "Reaigen virtual tour creator platform.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ "--font-brand": "ui-serif, Georgia, serif" } as React.CSSProperties}>
      <head>
        <link rel="dns-prefetch" href="//app-reaigen.publicrouter.sk" />
        <link rel="preconnect" href="https://app-reaigen.publicrouter.sk" crossOrigin="anonymous" />
      </head>
      <body>
        <AuthProvider>
          <WebVitalsReporter />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
