import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  AsyncStringStorage,
  createInvalidatedSessionStorage,
  createSecureSessionStorage,
} from "./secureSessionStorageCore";

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: "sonhar-plus.supabase-session",
};

const nativeSecureStore: AsyncStringStorage = {
  getItem: (key) => SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS),
  removeItem: (key) => SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS),
};

/**
 * Supabase auth storage. The web keeps the platform's localStorage-backed
 * AsyncStorage behavior; native platforms persist the session in Keychain /
 * Android Keystore-backed SecureStore without requiring a biometric prompt.
 */
const baseSessionStorage: AsyncStringStorage =
  Platform.OS === "web"
    ? AsyncStorage
    : createSecureSessionStorage({
        secureStore: nativeSecureStore,
        legacyStore: AsyncStorage,
      });

const DELETED_ACCOUNT_SESSION_PREFIX = "sonhar:deleted-account-session:v1:";

async function isDeletedAccountSession(userId: string) {
  return (await AsyncStorage.getItem(`${DELETED_ACCOUNT_SESSION_PREFIX}${userId}`)) === "1";
}

export async function markDeletedAccountSession(userId: string) {
  if (!userId) return;
  await AsyncStorage.setItem(`${DELETED_ACCOUNT_SESSION_PREFIX}${userId}`, "1");
}

/**
 * The account-deletion tombstone prevents a late refresh or a failed physical
 * cleanup from restoring a credential whose Auth user no longer exists.
 */
export const secureSessionStorage: AsyncStringStorage = createInvalidatedSessionStorage({
  storage: baseSessionStorage,
  isInvalidatedUser: isDeletedAccountSession,
});

export { createSecureSessionStorage } from "./secureSessionStorageCore";
export type { AsyncStringStorage } from "./secureSessionStorageCore";
