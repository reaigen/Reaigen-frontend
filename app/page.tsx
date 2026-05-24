"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./components/hooks/use-auth";
import { AuthGate } from "./components/auth-gate";

export default function Home() {
  const { isAuthenticated, isLoading, login, register } = useAuth();
  const router = useRouter();
  const [showAuth, setShowAuth] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
    if (!isLoading && !isAuthenticated) {
      setShowAuth(true);
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/30">
      <AuthGate
        open={showAuth}
        onClose={() => {}}
        onLogin={login}
        onRegister={register}
      />
    </div>
  );
}
