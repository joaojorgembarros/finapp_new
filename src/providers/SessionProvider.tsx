// src/providers/SessionProvider.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { Session } from "@supabase/supabase-js";
import { appLockStorage } from "../lib/appLockStorage";
import { clearSignedGoalPhotoCacheForUser } from "../lib/goals";
import { clearNewOnboardingState } from "../lib/newOnboarding";
import {
  markDeletedAccountSession,
  secureSessionStorage,
} from "../lib/secureSessionStorage";
import {
  SUPABASE_AUTH_STORAGE_KEY,
  supabase,
  supabaseAuthLock,
} from "../lib/supabase";

export type SignOutResult = {
  remoteSignOutCompleted: boolean;
  activeAccountChanged: boolean;
};

export type LocalSessionClearResult = "cleared" | "different-user" | "failed";

type Ctx = {
  session: Session | null;
  userId: string | null;
  loading: boolean;
  signOut: () => Promise<SignOutResult>;
  clearExpiredSessionLocally: (expectedUserId: string) => Promise<LocalSessionClearResult>;
  finalizeDeletedAccountLocally: (
    deletedUserId: string,
  ) => Promise<LocalSessionClearResult>;
};

const SessionContext = createContext<Ctx | null>(null);

const clearStoredSession = async () => {
  await Promise.all([
    SUPABASE_AUTH_STORAGE_KEY,
    `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`,
    `${SUPABASE_AUTH_STORAGE_KEY}-user`,
  ].map((key) => secureSessionStorage.removeItem(key)));
};

const AUTH_STORAGE_LOCK_NAME = `lock:${SUPABASE_AUTH_STORAGE_KEY}`;

type StoredSessionIdentity =
  | { kind: "none" }
  | { kind: "user"; userId: string }
  | { kind: "unknown" };

const readStoredSessionIdentity = async (): Promise<StoredSessionIdentity> => {
  const rawSession = await secureSessionStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
  if (rawSession === null) return { kind: "none" };

  try {
    const parsed = JSON.parse(rawSession) as { user?: { id?: unknown } };
    return typeof parsed.user?.id === "string"
      ? { kind: "user", userId: parsed.user.id }
      : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
};

const LOCAL_SESSION_CLEAR_CHANNEL = `${SUPABASE_AUTH_STORAGE_KEY}:sonhar-local-clear`;

const broadcastExpectedLocalSessionClear = (expectedUserId: string) => {
  const BroadcastChannelConstructor = (
    globalThis as typeof globalThis & {
      BroadcastChannel?: new (name: string) => {
        postMessage: (message: unknown) => void;
        close: () => void;
      };
    }
  ).BroadcastChannel;
  if (!BroadcastChannelConstructor) return;
  let channel: InstanceType<typeof BroadcastChannelConstructor> | null = null;
  try {
    channel = new BroadcastChannelConstructor(LOCAL_SESSION_CLEAR_CHANNEL);
    channel.postMessage({ type: "CLEAR_EXPECTED_SESSION", userId: expectedUserId });
  } catch {
    // Cross-tab notification is best-effort; the local credential is already gone.
  } finally {
    try {
      channel?.close();
    } catch {
      // Closing a restricted/failed channel must not block local cleanup.
    }
  }
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
  const sessionRef = useRef<Session | null>(null);
  const authRevisionRef = useRef(0);
  const signOutPromiseRef = useRef<Promise<SignOutResult> | null>(null);
  const signingOutRef = useRef(false);
  const locallySignedOutUserIdRef = useRef<string | null>(null);
  const deletedAccountUserIdRef = useRef<string | null>(null);
  const pendingDeletedAccountCleanupRef = useRef<string | null>(null);
  const pendingLocalSessionCleanupRef = useRef<string | null>(null);

  const clearLocalSessionForUser = useCallback(async (
    expectedUserId: string,
    notifyOtherTabs = true,
  ): Promise<LocalSessionClearResult> => {
    if (!expectedUserId) return "failed";
    let cleared = false;
    let differentUserActive = false;

    try {
      await supabaseAuthLock(AUTH_STORAGE_LOCK_NAME, -1, async () => {
        const activeSession = sessionRef.current as Session | null;
        if (activeSession && activeSession.user.id !== expectedUserId) {
          differentUserActive = true;
          return;
        }

        const storedIdentity = await readStoredSessionIdentity();
        if (storedIdentity.kind === "user" && storedIdentity.userId !== expectedUserId) {
          differentUserActive = true;
          return;
        }
        if (storedIdentity.kind === "unknown" && !activeSession) {
          throw new Error("Stored session identity could not be verified.");
        }

        await clearStoredSession();
        cleared = true;
      });
    } catch {
      pendingLocalSessionCleanupRef.current = expectedUserId;
      const activeSession = sessionRef.current as Session | null;
      if (!activeSession || activeSession.user.id === expectedUserId) {
        sessionRef.current = null;
        setSession(null);
      }
      return "failed";
    }

    if (differentUserActive) {
      pendingLocalSessionCleanupRef.current = null;
      return "different-user";
    }
    if (!cleared) return "failed";

    pendingLocalSessionCleanupRef.current = null;
    const activeSession = sessionRef.current as Session | null;
    if (!activeSession || activeSession.user.id === expectedUserId) {
      sessionRef.current = null;
      setSession(null);
    }
    if (notifyOtherTabs) broadcastExpectedLocalSessionClear(expectedUserId);
    try {
      await supabase.removeAllChannels();
    } catch {
      // No persisted credential remains; channels also lose authorization on expiry.
    }
    return "cleared";
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const BroadcastChannelConstructor = globalThis.BroadcastChannel;
    if (!BroadcastChannelConstructor) return;

    let channel: InstanceType<typeof BroadcastChannelConstructor>;
    try {
      channel = new BroadcastChannelConstructor(LOCAL_SESSION_CLEAR_CHANNEL);
    } catch {
      return;
    }
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (
        !message
        || typeof message !== "object"
        || !("type" in message)
        || !("userId" in message)
        || (message as { type?: unknown }).type !== "CLEAR_EXPECTED_SESSION"
        || typeof (message as { userId?: unknown }).userId !== "string"
      ) return;
      const expectedUserId = (message as { userId: string }).userId;
      locallySignedOutUserIdRef.current = expectedUserId;
      authRevisionRef.current += 1;
      void clearLocalSessionForUser(
        expectedUserId,
        false,
      );
    };
    return () => {
      try {
        channel.close();
      } catch {
        // Cross-tab cleanup is best-effort in restricted browser contexts.
      }
    };
  }, [clearLocalSessionForUser]);

  const clearDeletedUserArtifacts = useCallback(async (deletedUserId: string) => {
    clearSignedGoalPhotoCacheForUser(deletedUserId);
    const tasks: Promise<unknown>[] = [clearNewOnboardingState(deletedUserId)];
    if (Platform.OS !== "web") tasks.push(appLockStorage.clearUser(deletedUserId));
    const results = await Promise.allSettled(tasks);
    const completed = results.every((result) => result.status === "fulfilled");
    pendingDeletedAccountCleanupRef.current = completed ? null : deletedUserId;
    return completed;
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const startingRevision = authRevisionRef.current;
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) throw error;
        if (!mounted || authRevisionRef.current !== startingRevision) return;

        sessionRef.current = data.session ?? null;
        setSession(sessionRef.current);
      } catch (error) {
        if (isInvalidRefreshTokenError(error)) {
          await clearStoredSession();
        } else if (__DEV__) {
          const code = typeof error === "object" && error && "code" in error
            ? String((error as { code?: unknown }).code)
            : "unknown";
          console.warn(`Could not restore Supabase session (${code}).`);
        }

        if (!mounted || authRevisionRef.current !== startingRevision) return;
        sessionRef.current = null;
        setSession(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      authRevisionRef.current += 1;
      if (signingOutRef.current && !sess && event === "SIGNED_OUT") return;
      if (
        signingOutRef.current
        && sess
        && sess.user.id === locallySignedOutUserIdRef.current
      ) return;
      if (sess && deletedAccountUserIdRef.current === sess.user.id) return;
      if (
        sess &&
        locallySignedOutUserIdRef.current === sess.user.id &&
        event !== "SIGNED_IN"
      ) return;
      if (event === "SIGNED_IN") locallySignedOutUserIdRef.current = null;
      sessionRef.current = sess ?? null;
      setSession(sessionRef.current);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const retryPendingCleanup = (state: string) => {
      const deletedUserId = pendingDeletedAccountCleanupRef.current;
      const localSessionUserId = pendingLocalSessionCleanupRef.current;
      if (state !== "active") return;
      if (deletedUserId) void clearDeletedUserArtifacts(deletedUserId);
      if (localSessionUserId) void clearLocalSessionForUser(localSessionUserId);
    };
    const subscription = AppState.addEventListener("change", retryPendingCleanup);
    return () => subscription.remove();
  }, [clearDeletedUserArtifacts, clearLocalSessionForUser]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const updateAutoRefresh = (state: string) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    };

    updateAutoRefresh(AppState.currentState);
    const subscription = AppState.addEventListener("change", updateAutoRefresh);
    return () => {
      subscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  const signOut = useCallback((): Promise<SignOutResult> => {
    if (signOutPromiseRef.current) return signOutPromiseRef.current;

    const currentUserId = session?.user?.id ?? null;
    const operation = (async () => {
      // Keep the current authenticated tree mounted until GoTrue finishes its
      // locked operation. Otherwise the login screen could admit user B while
      // signOut is still about to read and revoke the current stored token.
      signingOutRef.current = true;
      locallySignedOutUserIdRef.current = currentUserId;
      authRevisionRef.current += 1;

      let remoteSignOutCompleted = false;
      try {
        const { error } = await supabase.auth.signOut();
        remoteSignOutCompleted = !error;
      } catch {
        remoteSignOutCompleted = false;
      }

      if (!remoteSignOutCompleted) {
        // Serialize the local fallback with refresh/sign-in and recheck ownership
        // inside the same lock. A new account must never lose its session.
        try {
          await supabaseAuthLock(AUTH_STORAGE_LOCK_NAME, -1, async () => {
            const activeUserId = sessionRef.current?.user.id ?? null;
            if (activeUserId && activeUserId !== currentUserId) return;
            await clearStoredSession();
          });
        } catch {
          // Secure storage writes a durable removal marker before deleting the
          // published session; the in-memory tombstone also blocks late events.
        }
      }

      if (Platform.OS !== "web" && currentUserId) {
        try {
          await appLockStorage.clearUser(currentUserId);
        } catch {
          // The user namespace prevents these settings from leaking to another account.
        }
      }
      const activeSession = sessionRef.current as Session | null;
      const activeAccountChanged = Boolean(
        activeSession && activeSession.user.id !== currentUserId,
      );
      if (!activeAccountChanged) {
        sessionRef.current = null;
        setSession(null);
      }
      return { remoteSignOutCompleted, activeAccountChanged };
    })().finally(() => {
      signingOutRef.current = false;
      signOutPromiseRef.current = null;
    });

    signOutPromiseRef.current = operation;
    return operation;
  }, [session?.user?.id]);

  const clearExpiredSessionLocally = useCallback(async (expectedUserId: string) => {
    if (!expectedUserId) return "failed" as const;
    locallySignedOutUserIdRef.current = expectedUserId;
    authRevisionRef.current += 1;
    return clearLocalSessionForUser(expectedUserId);
  }, [clearLocalSessionForUser]);

  const finalizeDeletedAccountLocally = useCallback(async (deletedUserId: string) => {
    if (!deletedUserId) return "failed" as const;

    try {
      await markDeletedAccountSession(deletedUserId);
    } catch {
      // Continue with immediate locked cleanup; the normal retry remains active.
    }
    deletedAccountUserIdRef.current = deletedUserId;
    locallySignedOutUserIdRef.current = deletedUserId;
    authRevisionRef.current += 1;

    const activeSession = sessionRef.current as Session | null;
    if (activeSession?.user.id === deletedUserId || !activeSession) {
      setSession(null);
    }

    // Remove the persisted credential first; App Lock/onboarding/cache cleanup
    // follows only after the authenticated tree is durably disconnected.
    const localCleanup = await clearLocalSessionForUser(deletedUserId);
    await clearDeletedUserArtifacts(deletedUserId);
    const finalSession = sessionRef.current as Session | null;
    if (finalSession && finalSession.user.id !== deletedUserId) {
      return "different-user" as const;
    }
    return localCleanup;
  }, [clearDeletedUserArtifacts, clearLocalSessionForUser]);

  const value = useMemo<Ctx>(
    () => ({
      session,
      userId: session?.user?.id ?? null,
      loading,
      signOut,
      clearExpiredSessionLocally,
      finalizeDeletedAccountLocally,
    }),
    [session, loading, signOut, clearExpiredSessionLocally, finalizeDeletedAccountLocally]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
