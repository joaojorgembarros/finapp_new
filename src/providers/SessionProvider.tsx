// src/providers/SessionProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session } from "@supabase/supabase-js";
import { SUPABASE_AUTH_STORAGE_KEY, supabase } from "../lib/supabase";

type Ctx = {
  session: Session | null;
  userId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

const clearStoredSession = async () => {
  await AsyncStorage.multiRemove([
    SUPABASE_AUTH_STORAGE_KEY,
    `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`,
    `${SUPABASE_AUTH_STORAGE_KEY}-user`,
  ]);
};

const isInvalidRefreshTokenError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error);

  return /invalid refresh token|refresh token not found/i.test(message);
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) throw error;
        if (!mounted) return;

        setSession(data.session ?? null);
      } catch (error) {
        if (isInvalidRefreshTokenError(error)) {
          await clearStoredSession();
        } else {
          console.warn("Could not restore Supabase session", error);
        }

        if (!mounted) return;
        setSession(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      session,
      userId: session?.user?.id ?? null,
      loading,
      signOut: async () => {
        const { error } = await supabase.auth.signOut();

        if (error && isInvalidRefreshTokenError(error)) {
          await clearStoredSession();
          setSession(null);
          return;
        }

        if (error) throw error;
      },
    }),
    [session, loading]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
