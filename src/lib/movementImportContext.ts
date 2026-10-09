export type MovementRouteAfterImport = {
  tab: "movimentacoes";
  postImport: "1";
  importId: string;
  reconciledCommitments: string;
  cycleDate?: string;
};

export type MovementListContext = {
  statementImportId: string | null;
  seenPostImportId: string | null;
  resetListFilters: boolean;
  clearOnlyImportParam: boolean;
};

function present(value?: string | null) {
  const text = value?.trim() ?? "";
  return text.length ? text : null;
}

/**
 * Params written after a successful CSV import.
 * `importId` identifies the file for feedback. It is not a list filter.
 */
export function movementRouteAfterImport(input: {
  importId: string;
  reconciledCommitments: number;
  cycleDate?: string | null;
}): MovementRouteAfterImport {
  const reconciled = Number.isFinite(input.reconciledCommitments)
    ? Math.max(0, Math.trunc(input.reconciledCommitments))
    : 0;
  const route: MovementRouteAfterImport = {
    tab: "movimentacoes",
    postImport: "1",
    importId: input.importId,
    reconciledCommitments: String(reconciled),
  };
  if (input.cycleDate) route.cycleDate = input.cycleDate;
  return route;
}

/**
 * The consolidated list is the default after import.
 * `onlyImport` filters the list only after an explicit choice on the current mount.
 * A fresh mount (`seenPostImportId` null) never adopts `importId` or a leftover `onlyImport`.
 */
export function resolveMovementListContext(input: {
  routeImportId?: string | null;
  onlyImport?: string | null;
  postImportActive: boolean;
  seenPostImportId?: string | null;
}): MovementListContext {
  const routeImportId = present(input.routeImportId);
  const onlyImport = present(input.onlyImport);
  const seenPostImportId = present(input.seenPostImportId);

  if (input.postImportActive && routeImportId && seenPostImportId !== routeImportId) {
    return {
      statementImportId: null,
      seenPostImportId: routeImportId,
      resetListFilters: true,
      clearOnlyImportParam: Boolean(onlyImport),
    };
  }

  return {
    statementImportId: onlyImport,
    seenPostImportId,
    resetListFilters: false,
    clearOnlyImportParam: false,
  };
}
