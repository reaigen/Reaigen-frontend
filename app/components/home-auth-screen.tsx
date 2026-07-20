"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./hooks/use-auth";
import { AuthGate } from "./auth-gate";
import { PageLoading } from "./page-loading";

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
    return <PageLoading />;
  }

  return (
    <div className="min-h-screen flex items-start justify-center pt-[15vh] pb-10 bg-background animate-fade-in">
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
