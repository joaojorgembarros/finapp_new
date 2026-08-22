import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createOpenFinanceClient } from "../lib/open-finance-client";
import {
  createOpenFinancePolpCompletionController,
  readCompletionIdentity,
  type OpenFinancePolpCompletionSnapshot,
} from "../lib/open-finance-polp-completion";
import type {
  OpenFinancePolpAuthorizationPhase,
  OpenFinancePolpCompletionContext,
} from "../lib/open-finance-polp-authorization";
import { supabase } from "../lib/supabase";

export function useOpenFinancePolpCompletion(input: {
  authorizationPhase: OpenFinancePolpAuthorizationPhase;
  completionContext: OpenFinancePolpCompletionContext | null;
}) {
  const client = useMemo(
    () => createOpenFinanceClient({ functions: supabase.functions }),
    [],
  );
  const inputRef = useRef(input);
  inputRef.current = input;
  const controller = useRef(createOpenFinancePolpCompletionController({
    completeConnection: (request) => client.completeConnection(request),
    getActiveContext: () => readCompletionIdentity({
      authorizationPhase: inputRef.current.authorizationPhase,
      householdId: inputRef.current.completionContext?.householdId,
      consentId: inputRef.current.completionContext?.consentId,
    }),
  })).current;
  const [snapshot, setSnapshot] = useState<OpenFinancePolpCompletionSnapshot>(controller.snapshot);

  const activeIdentity = readCompletionIdentity({
    authorizationPhase: input.authorizationPhase,
    householdId: input.completionContext?.householdId,
    consentId: input.completionContext?.consentId,
  });

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    controller.syncActiveIdentity();
  }, [controller, activeIdentity?.householdId, activeIdentity?.consentId]);

  const complete = useCallback(async () => {
    const current = inputRef.current;
    await controller.complete({
      authorizationPhase: current.authorizationPhase,
      householdId: current.completionContext?.householdId,
      consentId: current.completionContext?.consentId,
    });
  }, [controller]);

  const retry = useCallback(() => controller.retry(), [controller]);
  const reset = useCallback(() => controller.reset(), [controller]);

  return {
    ...snapshot,
    complete,
    retry,
    reset,
  };
}
