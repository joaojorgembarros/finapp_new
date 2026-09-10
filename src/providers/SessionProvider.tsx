// src/providers/SessionProvider.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";
import { Session } from "@supabase/supabase-js";
import {
  completeGoogleOAuthCallback,
  googleOAuthDedupe,
  isGoogleAuthCancelled,
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
  discardInvalidAuthSession,
  isDefinitivelyInvalidAuthError,
  restoreValidatedSession,
  shouldApplyAuthStateSession,
} from "../lib/sessionValidity";

export type SignOutResult = {
  remoteSignOutCompleted: boolean;
  activeAccountChanged: boolean;
};

type Ctx = {
  session: Session | null;
  userId: string | null;
  loading: boolean;
  passwordRecoveryPending: boolean;
  passwordRecoveryActive: boolean;
  passwordRecoveryError: string | null;
  passwordRecoveryOpen: boolean;
  endPasswordRecovery: () => void;
  consumePasswordRecoveryUrl: (url: string | null | undefined) => Promise<void>;
  signOut: () => Promise<SignOutResult>;
};

const SessionContext = createContext<Ctx | null>(null);

async function completeIncomingGoogleOAuth(url: string) {
  try {
    await completeGoogleOAuthCallback(url, supabase.auth, googleOAuthDedupe);
  } catch (error) {
    if (!isGoogleAuthCancelled(error) && typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn("Could not complete Google sign-in callback.");
    }
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState(false);
  const [passwordRecoveryError, setPasswordRecoveryError] = useState<string | null>(null);

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
      await completeIncomingGoogleOAuth(url);
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
  }, [consumePasswordRecoveryUrl]);

  const endPasswordRecovery = () => {
    setPasswordRecoveryActive(false);
    setPasswordRecoveryPending(false);
    setPasswordRecoveryError(null);
  };

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
      endPasswordRecovery,
      consumePasswordRecoveryUrl,
      signOut: async () => {
        const { error } = await supabase.auth.signOut();

        if (error && isDefinitivelyInvalidAuthError(error)) {
          await discardInvalidAuthSession(supabase.auth);
          setSession(null);
          endPasswordRecovery();
          return { remoteSignOutCompleted: false, activeAccountChanged: false };
        }

        if (error) throw error;
        return { remoteSignOutCompleted: true, activeAccountChanged: false };
      },
    }),
    [session, loading, passwordRecoveryPending, passwordRecoveryActive, passwordRecoveryError, passwordRecoveryOpen, consumePasswordRecoveryUrl]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
