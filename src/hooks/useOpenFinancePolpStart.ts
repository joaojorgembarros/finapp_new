import { useCallback, useMemo, useRef, useState } from "react";

import { createOpenFinanceClient } from "../lib/open-finance-client";
import {
  createOpenFinancePolpStartController,
  toSafeOpenFinancePolpStartMessage,
} from "../lib/open-finance-polp-start";
import type {
  OpenFinancePolpInstitutionListItem,
  OpenFinancePolpProduct,
  OpenFinancePolpStartConnectionResponse,
} from "../lib/open-finance-contract";
import { supabase } from "../lib/supabase";
import { useSession } from "../providers/SessionProvider";
import { useHouseholdId } from "./useHousehold";

export type StartOpenFinancePolpConnectionInput = {
  institutionId: string;
  cpf: string;
  cnpj?: string | null;
  products?: OpenFinancePolpProduct[];
};

export function useOpenFinancePolpStart() {
  const { userId } = useSession();
  const household = useHouseholdId(userId);
  const client = useMemo(
    () => createOpenFinanceClient({ functions: supabase.functions }),
    [],
  );
  const controller = useRef(createOpenFinancePolpStartController(client)).current;

  const [institutions, setInstitutions] = useState<OpenFinancePolpInstitutionListItem[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
  const [institutionsError, setInstitutionsError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const reloadInstitutions = useCallback(async () => {
    setInstitutionsLoading(true);
    setInstitutionsError(null);
    try {
      const next = await controller.loadInstitutions();
      setInstitutions(next);
      return next;
    } catch (error) {
      setInstitutions([]);
      setInstitutionsError(toSafeOpenFinancePolpStartMessage(error));
      throw error;
    } finally {
      setInstitutionsLoading(false);
    }
  }, [controller]);

  const startConnection = useCallback(async (
    input: StartOpenFinancePolpConnectionInput,
  ): Promise<OpenFinancePolpStartConnectionResponse> => {
    setStartError(null);
    setStarting(true);
    try {
      return await controller.startConnection({
        householdId: household.householdId,
        institutionId: input.institutionId,
        cpf: input.cpf,
        cnpj: input.cnpj,
        products: input.products,
      });
    } catch (error) {
      setStartError(toSafeOpenFinancePolpStartMessage(error));
      throw error;
    } finally {
      setStarting(controller.starting);
    }
  }, [controller, household.householdId]);

  return {
    institutions,
    institutionsLoading,
    institutionsError,
    reloadInstitutions,
    startConnection,
    starting,
    startError,
    householdId: household.householdId,
    householdLoading: household.loading,
  };
}
