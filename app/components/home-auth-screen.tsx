"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./hooks/use-auth";
import { AuthGate } from "./auth-gate";
import { PageLoading } from "./page-loading";
import { takeSessionEndReason, type SessionEndReason } from "../lib/session-end";

export function HomeAuthScreen() {
  const { isAuthenticated, isLoading, login, register, serviceUnavailable, retryBoot } = useAuth();
  const router = useRouter();
  const [navigating, setNavigating] = React.useState(false);
  // Left by the API client when the proxy refused to renew the session; read
  // once so the explanation shows on this visit and not on the next.
  const [sessionEnd, setSessionEnd] = React.useState<SessionEndReason | null>(null);
  // After sign-up the account waits for its email link; the form is replaced
  // by the "check your inbox" card until the user goes back to sign in.
  const [pendingVerificationEmail, setPendingVerificationEmail] = React.useState<string | null>(null);
  // The verification page sends people here with ?verified=1 so the sign-in
  // form can say the account is active. The flag is not kept in the URL.
  const [verifiedNotice, setVerifiedNotice] = React.useState(false);
  React.useEffect(() => {
    setSessionEnd(takeSessionEndReason());
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") {
      setVerifiedNotice(true);
      window.history.replaceState(window.history.state, "", "/");
    }
  }, []);

  React.useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

  React.useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setNavigating(true);
      router.replace("/dashboard");
    }
  }, [isLoading, isAuthenticated, router]);

  // Show branded loader only while checking auth or navigating away
  if (isLoading || navigating) {
    return <PageLoading />;
  }

  return (
    <div className="min-h-[100dvh] w-full bg-card animate-fade-in">
      <AuthGate
        open
        onClose={() => {}}
        sessionEnd={sessionEnd}
        serviceUnavailable={serviceUnavailable}
        onRetry={() => { void retryBoot(); }}
        onLogin={async (email, password) => {
          const challenge = await login(email, password);
          if (challenge) return challenge;
          setNavigating(true);
        }}
        onRegister={async (data) => {
          const result = await register(data);
          if (result.verificationRequired) {
            setPendingVerificationEmail(data.email);
            return;
          }
          setNavigating(true);
        }}
        pendingVerificationEmail={pendingVerificationEmail}
        onPendingVerificationDismiss={() => setPendingVerificationEmail(null)}
        verifiedNotice={verifiedNotice}
      />
    </div>
  );
}
