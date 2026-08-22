import * as Linking from "expo-linking";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { createOpenFinanceClient } from "../lib/open-finance-client";
import {
  createOpenFinancePolpAuthorizationController,
  type OpenFinancePolpAuthorizationSnapshot,
} from "../lib/open-finance-polp-authorization";
import type { OpenFinancePolpStartConnectionResponse } from "../lib/open-finance-contract";
import { supabase } from "../lib/supabase";

type StartConnection = (input: {
  institutionId: string;
  cpf: string;
}) => Promise<OpenFinancePolpStartConnectionResponse>;

export function useOpenFinancePolpAuthorization(input: {
  householdId: string | null;
  startConnection: StartConnection;
}) {
  const client = useMemo(
    () => createOpenFinanceClient({ functions: supabase.functions }),
    [],
  );
  const startConnectionRef = useRef(input.startConnection);
  startConnectionRef.current = input.startConnection;
  const householdIdRef = useRef(input.householdId);
  householdIdRef.current = input.householdId;

  const controller = useRef(createOpenFinancePolpAuthorizationController({
    startConnection: (value) => startConnectionRef.current(value),
    getConsent: (value) => client.getConsent(value),
    openUrl: (url) => Linking.openURL(url).then(() => undefined),
  })).current;

  const [snapshot, setSnapshot] = useState<OpenFinancePolpAuthorizationSnapshot>(controller.snapshot);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const listenToAppState = snapshot.hasConsent
    && (snapshot.phase === "awaiting_authorization"
      || snapshot.phase === "checking");

  useEffect(() => {
    if (!listenToAppState) return;
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      controller.handleAppState(next);
    });
    return () => {
      subscription.remove();
    };
  }, [controller, listenToAppState]);

  const start = useCallback(async (value: { institutionId: string; cpf: string }) => {
    const householdId = householdIdRef.current;
    if (!householdId) return;
    await controller.start({ householdId, ...value });
  }, [controller]);

  const openAuthorization = useCallback(() => controller.openAuthorization(), [controller]);
  const checkAgain = useCallback(() => controller.checkAgain(), [controller]);
  const reset = useCallback(() => controller.reset(), [controller]);

  return {
    ...snapshot,
    completionContext: controller.completionContext,
    start,
    openAuthorization,
    checkAgain,
    reset,
  };
}
