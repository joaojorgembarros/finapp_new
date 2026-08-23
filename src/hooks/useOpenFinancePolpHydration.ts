import { useEffect, useMemo, useState } from "react";

import { createOpenFinanceClient, OpenFinanceClientError } from "../lib/open-finance-client";
import type { OpenFinancePolpCompletedResource } from "../lib/open-finance-polp-completion";
import { fetchHydratedPolpSyncResources } from "../lib/open-finance-polp-hydrate";
import { supabase } from "../lib/supabase";

const HYDRATION_ERROR = "Não foi possível carregar a conexão existente.";

export function useOpenFinancePolpHydration(input: {
  householdId: string | null;
  householdLoading: boolean;
}) {
  const client = useMemo(
    () => createOpenFinanceClient({ functions: supabase.functions }),
    [],
  );
  const [snapshot, setSnapshot] = useState<{
    householdId: string | null;
    resources: OpenFinancePolpCompletedResource[];
    loading: boolean;
    error: string | null;
  }>({
    householdId: null,
    resources: [],
    loading: false,
    error: null,
  });

  const activeHouseholdId = input.householdLoading ? null : input.householdId;
  const stale = snapshot.householdId !== activeHouseholdId;

  useEffect(() => {
    if (!activeHouseholdId) {
      setSnapshot({
        householdId: null,
        resources: [],
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    setSnapshot((previous) => ({
      householdId: activeHouseholdId,
      resources: previous.householdId === activeHouseholdId ? previous.resources : [],
      loading: true,
      error: null,
    }));

    void fetchHydratedPolpSyncResources(
      (request) => client.listConnections(request),
      activeHouseholdId,
    ).then((resources) => {
      if (cancelled) return;
      setSnapshot({
        householdId: activeHouseholdId,
        resources,
        loading: false,
        error: null,
      });
    }).catch((caught) => {
      if (cancelled) return;
      setSnapshot({
        householdId: activeHouseholdId,
        resources: [],
        loading: false,
        error: caught instanceof OpenFinanceClientError
          ? (caught.message || HYDRATION_ERROR)
          : HYDRATION_ERROR,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [client, activeHouseholdId]);

  return {
    resources: stale ? [] : snapshot.resources,
    loading: Boolean(activeHouseholdId) && (stale || snapshot.loading),
    error: stale ? null : snapshot.error,
  };
}
