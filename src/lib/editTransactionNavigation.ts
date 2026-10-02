import type { Href } from "expo-router";
import type { Edge } from "react-native-safe-area-context";

export const EDIT_TRANSACTION_PATH = "/(app)/edit-transaction";

export function firstSearchParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

export function getEditTransactionHref(transactionId: string): Href {
  return {
    pathname: EDIT_TRANSACTION_PATH,
    params: { transactionId },
  };
}

export function getEditTransactionStackOptions(platform: string) {
  if (platform === "ios") {
    return {
      headerShown: false,
      presentation: "pageSheet" as const,
      gestureEnabled: true,
      sheetGrabberVisible: true,
      sheetAllowedDetents: [1],
    };
  }

  return {
    headerShown: false,
    presentation: "card" as const,
    gestureEnabled: true,
  };
}

export function getEditTransactionSafeAreaEdges(platform: string): Edge[] {
  return platform === "ios" ? ["bottom"] : ["top", "bottom"];
}
