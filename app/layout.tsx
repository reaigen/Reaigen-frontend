import type { Metadata } from "next";
import { Noto_Serif_Display } from "next/font/google";
import "./globals.css";

export const brandSerif = Noto_Serif_Display({
  subsets: ["latin"],
  weight: ["300", "500"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Reaigen",
  description: "Reaigen Creator Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={brandSerif.variable}>
      <body>{children}</body>
    </html>
  );
}
