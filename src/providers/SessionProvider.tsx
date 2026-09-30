// src/providers/SessionProvider.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Linking } from "react-native";
import { Session } from "@supabase/supabase-js";
import {
  googleOAuthDedupe,
  reportGoogleOAuthCallback,
} from "../lib/googleAuth";
import {
  completePasswordRecoveryCallback,
  getPasswordRecoveryLinkErrorMessage,
  parsePasswordRecoveryUrl,
  passwordRecoveryDedupe,
  shouldOpenPasswordRecoveryScreen,
} from "../lib/passwordRecovery";
import { supabase } from "../lib/supabase";
import {
  restoreValidatedSession,
  shouldApplyAuthStateSession,
} from "../lib/sessionValidity";
import {
  createSignOutGate,
  performSignOut,
  type SignOutResult,
} from "../lib/signOutSession";

export type { SignOutResult };

type Ctx = {
  session: Session | null;
  userId: string | null;
  loading: boolean;
  passwordRecoveryPending: boolean;
  passwordRecoveryActive: boolean;
  passwordRecoveryError: string | null;
  passwordRecoveryOpen: boolean;
  googleAuthError: string | null;
  endPasswordRecovery: () => void;
  clearGoogleAuthError: () => void;
  consumePasswordRecoveryUrl: (url: string | null | undefined) => Promise<void>;
  consumeGoogleOAuthUrl: (url: string | null | undefined) => Promise<void>;
  signOut: () => Promise<SignOutResult>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState(false);
  const [passwordRecoveryError, setPasswordRecoveryError] = useState<string | null>(null);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(null);
  const signOutGateRef = useRef<ReturnType<typeof createSignOutGate> | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      try {
        const result = await restoreValidatedSession(supabase.auth);
        if (!mounted) return;
        setSession(result.status === "authenticated" ? result.session : null);
      } catch (error) {
        console.warn("Could not restore Supabase session", error);
        if (!mounted) return;
        setSession(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (!shouldApplyAuthStateSession(event)) return;
      if (event === "PASSWORD_RECOVERY") setPasswordRecoveryActive(true);
      if (event === "SIGNED_OUT") {
        setPasswordRecoveryActive(false);
        setPasswordRecoveryPending(false);
      }
      setSession(sess ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const consumeGoogleOAuthUrl = useCallback(async (url: string | null | undefined) => {
    if (!url) return;
    const report = await reportGoogleOAuthCallback(url, supabase.auth, googleOAuthDedupe);
    if (report.kind === "unrelated" || report.kind === "ignored" || report.kind === "cancelled") {
      return;
    }
    if (report.kind === "error") {
      setGoogleAuthError(report.errorMessage);
      return;
    }
    setGoogleAuthError(null);
    setSession(report.session);
  }, []);

  const consumePasswordRecoveryUrl = useCallback(async (url: string | null | undefined) => {
    if (!url) return;
    const parsed = parsePasswordRecoveryUrl(url);
    if (parsed.kind === "unrelated") return;
    if (parsed.kind === "code" && passwordRecoveryDedupe.lastCode === parsed.code) {
      setPasswordRecoveryActive(true);
      setPasswordRecoveryError(null);
      return;
    }
    if (parsed.kind === "code" && passwordRecoveryDedupe.inFlightCode === parsed.code) return;

    setPasswordRecoveryPending(true);
    setPasswordRecoveryError(null);
    try {
      const result = await completePasswordRecoveryCallback(url, supabase.auth, passwordRecoveryDedupe);
      if (result.processed) {
        setSession(result.session);
        setPasswordRecoveryActive(true);
        setPasswordRecoveryError(null);
      }
    } catch (error) {
      setPasswordRecoveryActive(false);
      setPasswordRecoveryError(getPasswordRecoveryLinkErrorMessage(error));
    } finally {
      setPasswordRecoveryPending(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const completeFromUrl = async (url: string | null) => {
      if (!url || cancelled) return;
      await consumeGoogleOAuthUrl(url);
      if (cancelled) return;
      await consumePasswordRecoveryUrl(url);
    };

    void Linking.getInitialURL().then(completeFromUrl);
    const subscription = Linking.addEventListener("url", (event) => {
      void completeFromUrl(event.url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [consumeGoogleOAuthUrl, consumePasswordRecoveryUrl]);

  const endPasswordRecovery = () => {
    setPasswordRecoveryActive(false);
    setPasswordRecoveryPending(false);
    setPasswordRecoveryError(null);
  };

  const clearGoogleAuthError = useCallback(() => {
    setGoogleAuthError(null);
  }, []);

  if (!signOutGateRef.current) {
    signOutGateRef.current = createSignOutGate(async () => {
      const result = await performSignOut(supabase.auth);
      if (result.localSessionCleared) {
        setSession(null);
        setPasswordRecoveryActive(false);
        setPasswordRecoveryPending(false);
        setPasswordRecoveryError(null);
      }
      return result;
    });
  }

  const passwordRecoveryOpen = shouldOpenPasswordRecoveryScreen({
    pending: passwordRecoveryPending,
    active: passwordRecoveryActive,
    error: passwordRecoveryError,
  });

  const value = useMemo<Ctx>(
    () => ({
      session,
      userId: session?.user?.id ?? null,
      loading,
      passwordRecoveryPending,
      passwordRecoveryActive,
      passwordRecoveryError,
      passwordRecoveryOpen,
      googleAuthError,
      endPasswordRecovery,
      clearGoogleAuthError,
      consumePasswordRecoveryUrl,
      consumeGoogleOAuthUrl,
      signOut: signOutGateRef.current!,
    }),
    [
      session,
      loading,
      passwordRecoveryPending,
      passwordRecoveryActive,
      passwordRecoveryError,
      passwordRecoveryOpen,
      googleAuthError,
      clearGoogleAuthError,
      consumePasswordRecoveryUrl,
      consumeGoogleOAuthUrl,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
