import type { Metadata } from "next";
import { VerifyEmailFlow } from "../components/account-email-flow";

export const metadata: Metadata = {
  title: "Reaigen",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] ?? "" : params.token ?? "";
  const language = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  return <VerifyEmailFlow token={token} language={language} />;
}
