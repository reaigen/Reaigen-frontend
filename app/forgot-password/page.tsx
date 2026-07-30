import type { Metadata } from "next";
import { ForgotPasswordFlow } from "../components/account-email-flow";

export const metadata: Metadata = {
  title: "Reaigen",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const value = (await searchParams).lang;
  const language = Array.isArray(value) ? value[0] : value;
  return <ForgotPasswordFlow language={language} />;
}
