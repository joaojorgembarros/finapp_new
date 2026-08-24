import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createOpenFinanceClient } from "../lib/open-finance-client";
import {
  createOpenFinancePolpDisconnectController,
  type OpenFinancePolpDisconnectSnapshot,
} from "../lib/open-finance-polp-disconnect";
import { supabase } from "../lib/supabase";

export function useOpenFinancePolpDisconnect() {
  const client = useMemo(
    () => createOpenFinanceClient({ functions: supabase.functions }),
    [],
  );
  const controller = useRef(createOpenFinancePolpDisconnectController({
    disconnectConnection: (request) => client.disconnectConnection(request),
  })).current;
  const [snapshot, setSnapshot] = useState<OpenFinancePolpDisconnectSnapshot>(controller.snapshot);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const start = useCallback((input: {
    householdId: string | null;
    connectionId: string | null;
  }) => controller.start(input), [controller]);
  const reset = useCallback(() => controller.reset(), [controller]);

  return {
    ...snapshot,
    start,
    reset,
  };
}
