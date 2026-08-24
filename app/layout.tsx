import type { Metadata, Viewport } from "next";
import { DM_Serif_Display } from "next/font/google";
import "./globals.css";

/**
 * The brand serif, matched to the marketing site (reaigen.com), which sets the
 * wordmark in DM Serif Display 400. The app previously fell back to
 * `ui-serif, Georgia`, so the mark rendered as New York on Apple platforms and
 * as Georgia everywhere else — two different logos depending on the device.
 *
 * Only the wordmark uses this; body copy stays on the system stack for iOS
 * parity. `latin` is enough because the mark itself is "Reaigen" — no
 * Slovak/Czech diacritics ever pass through it.
 */
const brandSerif = DM_Serif_Display({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  fallback: ["ui-serif", "Georgia", "serif"],
});
import { AuthProvider } from "./components/hooks/use-auth";
import { WorkspaceShell } from "./components/workspace-shell";
import { WebVitalsReporter } from "./components/web-vitals-reporter";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Keep browser zoom available. Gesture-heavy editors constrain their own
  // canvases; the document itself must remain magnifiable for low-vision users.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
  // Emits <meta name="color-scheme" content="light">. Paired with the same
  // declaration on `html` in globals.css, this is what keeps Chrome for
  // Android's Auto Dark Theme from repainting the app on phones set to a dark
  // system theme. The product has no dark mode; being force-darkened turned
  // the white gallery lightbox grey.
  colorScheme: "light",
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
    <html lang="en" className={brandSerif.variable}>
      <head>
        <link rel="dns-prefetch" href="//app-reaigen.publicrouter.sk" />
        <link rel="preconnect" href="https://app-reaigen.publicrouter.sk" crossOrigin="anonymous" />
      </head>
      <body>
        <AuthProvider>
          <WebVitalsReporter />
          <WorkspaceShell>{children}</WorkspaceShell>
        </AuthProvider>
      </body>
    </html>
  );
}
