// src/lib/supabase.ts
import "react-native-url-polyfill/auto";
import { Platform } from "react-native";
import { createClient, navigatorLock, processLock } from "@supabase/supabase-js";
import { secureSessionStorage } from "./secureSessionStorage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const apiKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!url || !apiKey) {
  const isDevelopment = typeof __DEV__ !== "undefined" && __DEV__;
  const missingVariables = [
    !url ? "EXPO_PUBLIC_SUPABASE_URL" : null,
    !apiKey
      ? "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ou EXPO_PUBLIC_SUPABASE_ANON_KEY durante a transição)"
      : null,
  ].filter(Boolean).join(", ");

  throw new Error(
    isDevelopment
      ? `Configuração do Supabase ausente: ${missingVariables}. Confira o arquivo .env local.`
      : "Configuração do Supabase ausente.",
  );
}

export const SUPABASE_AUTH_STORAGE_KEY = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

export async function supabaseAuthLock<Result>(
  name: string,
  acquireTimeout: number,
  operation: () => Promise<Result>,
): Promise<Result> {
  const webLocksAvailable = Platform.OS === "web"
    && typeof globalThis.navigator !== "undefined"
    && "locks" in globalThis.navigator;
  return webLocksAvailable
    ? navigatorLock(name, acquireTimeout, operation)
    : processLock(name, acquireTimeout, operation);
}

export const supabase = createClient(url, apiKey, {
  auth: {
    storage: secureSessionStorage,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: "pkce",
    lock: supabaseAuthLock,
  },
});
