import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createAppLockStorage, type AppLockKeyValueStore } from "./appLockStorageCore";

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const nativeKeyValueStore: AppLockKeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key, secureStoreOptions),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, secureStoreOptions),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, secureStoreOptions),
};

const unavailableWebStore: AppLockKeyValueStore = {
  getItem: async () => {
    throw new Error("App Lock storage is unavailable on web.");
  },
  setItem: async () => {
    throw new Error("App Lock storage is unavailable on web.");
  },
  deleteItem: async () => {
    throw new Error("App Lock storage is unavailable on web.");
  },
};

export const appLockStorage = createAppLockStorage(
  Platform.OS === "web" ? unavailableWebStore : nativeKeyValueStore,
);

export { appLockStorageKeys, createAppLockStorage } from "./appLockStorageCore";
export type { AppLockKeyValueStore, AppLockSnapshot } from "./appLockStorageCore";

