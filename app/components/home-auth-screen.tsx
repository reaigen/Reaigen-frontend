"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./hooks/use-auth";
import { AuthGate } from "./auth-gate";

export function HomeAuthScreen() {
  const { isAuthenticated, isLoading, login, register } = useAuth();
  const router = useRouter();
  const [navigating, setNavigating] = React.useState(false);

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
    return (
      <div className="min-h-screen flex items-start justify-center pt-[20vh] bg-gradient-to-b from-white via-muted/20 to-muted/40">
        <div className="flex flex-col items-center gap-3">
          <span
            className="text-[26px] text-foreground/80"
            style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400, letterSpacing: "0.01em" }}
          >
            Reaigen
          </span>
          <div className="h-0.5 w-12 rounded-full bg-foreground/10 overflow-hidden">
            <div className="h-full w-1/2 rounded-full bg-foreground/40 animate-[shimmer-bar_1.2s_ease-in-out_infinite]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-start justify-center pt-[15vh] pb-10 bg-gradient-to-b from-white via-muted/20 to-muted/40 animate-fade-in">
      <AuthGate
        open
        onClose={() => {}}
        onLogin={async (email, password) => {
          await login(email, password);
          setNavigating(true);
        }}
        onRegister={async (data) => {
          await register(data);
          setNavigating(true);
        }}
      />
    </div>
  );
}
