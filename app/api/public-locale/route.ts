import { headers } from "next/headers";
import { NextResponse } from "next/server";

const COUNTRY_LANGUAGES: Record<string, "en" | "sk" | "cs" | "de"> = {
  SK: "sk",
  CZ: "cs",
  DE: "de",
  AT: "de",
  LI: "de",
  CH: "de",
  US: "en",
  GB: "en",
  IE: "en",
  CA: "en",
  AU: "en",
  NZ: "en",
};

export async function GET() {
  const requestHeaders = await headers();
  const country = (
    requestHeaders.get("x-vercel-ip-country")
    ?? requestHeaders.get("cf-ipcountry")
    ?? requestHeaders.get("cloudfront-viewer-country")
    ?? ""
  ).trim().toUpperCase();
  const language = COUNTRY_LANGUAGES[country] ?? null;
  return NextResponse.json(
    { country: country || null, language },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
