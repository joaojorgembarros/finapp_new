export type PendingRecoveryDecisionArgs = {
  pendingPath?: string | null;
  loading: boolean;
  authenticated: boolean;
  protectedTreeMounted: boolean;
  locked: boolean;
  privacyCovered: boolean;
};

export function shouldNavigatePendingRecovery(args: PendingRecoveryDecisionArgs): boolean {
  const { pendingPath, loading, authenticated, protectedTreeMounted, locked, privacyCovered } = args;
  if (!pendingPath) return false;
  if (loading) return false;
  if (!authenticated) return false;
  if (!protectedTreeMounted) return false;
  if (locked || privacyCovered) return false;
  return true;
}
