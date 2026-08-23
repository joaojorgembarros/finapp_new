import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createOpenFinanceClient } from "../lib/open-finance-client";
import type {
  OpenFinancePolpCompletedResource,
  OpenFinancePolpCompletionPhase,
} from "../lib/open-finance-polp-completion";
import {
  POLP_SYNC_CONTROLLER_REVISION,
  createOpenFinancePolpSyncController,
  localPolpSyncMonthKey,
  readPolpSyncContext,
  type OpenFinancePolpSyncSnapshot,
} from "../lib/open-finance-polp-sync";
import { supabase } from "../lib/supabase";

export function useOpenFinancePolpSync(input: {
  completionPhase: OpenFinancePolpCompletionPhase;
  householdId: string | null;
  connections: OpenFinancePolpCompletedResource[];
}) {
  const client = useMemo(
    () => createOpenFinanceClient({ functions: supabase.functions }),
    [],
  );
  const [monthKey] = useState(() => localPolpSyncMonthKey());
  const inputRef = useRef({ ...input, monthKey });
  inputRef.current = { ...input, monthKey };
  const controller = useMemo(
    () => createOpenFinancePolpSyncController({
      syncMonth: (request) => client.syncMonth(request),
      getActiveContext: () => readPolpSyncContext(inputRef.current),
    }),
    [client, POLP_SYNC_CONTROLLER_REVISION],
  );
  const [snapshot, setSnapshot] = useState<OpenFinancePolpSyncSnapshot>(controller.snapshot);

  const active = readPolpSyncContext(inputRef.current);
  const identityKey = active
    ? `${active.householdId}:${active.monthKey}:${active.connections.map((item) => item.connectionId).join(",")}`
    : "";

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    controller.syncActiveIdentity();
  }, [controller, identityKey]);

  const start = useCallback(() => controller.start(), [controller]);
  const retryFailed = useCallback(() => controller.retryFailed(), [controller]);
  const reset = useCallback(() => controller.reset(), [controller]);

  return {
    ...snapshot,
    start,
    retryFailed,
    reset,
  };
}
