import type { Metadata, Viewport } from "next";
import { Noto_Serif_Display } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./components/hooks/use-auth";

export const brandSerif = Noto_Serif_Display({
  subsets: ["latin"],
  weight: ["300", "500"],
  variable: "--font-brand",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Reaigen",
  description: "Reaigen Creator Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={brandSerif.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
