// src/lib/supabase.ts
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
export const SUPABASE_AUTH_STORAGE_KEY = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

export const supabase = createClient(url, anon, {
  auth: {
    storage: AsyncStorage,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
