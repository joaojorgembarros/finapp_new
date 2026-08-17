export type TryNavigateArgs = {
  pendingPath?: string | null;
  loading: boolean;
  authenticated: boolean;
  protectedTreeMounted: boolean;
  locked: boolean;
  privacyCovered: boolean;
  navigate: (path: string) => Promise<unknown> | unknown;
  consume: () => string | null;
};

export class PendingRecoveryNavigator {
  private inFlight = false;

  async tryNavigate(args: TryNavigateArgs): Promise<boolean> {
    const { pendingPath, loading, authenticated, protectedTreeMounted, locked, privacyCovered, navigate, consume } = args;
    if (!pendingPath) return false;
    if (loading) return false;
    if (!authenticated) return false;
    if (!protectedTreeMounted) return false;
    if (locked || privacyCovered) return false;
    if (this.inFlight) return false;

    this.inFlight = true;
    try {
      // Attempt navigation. Await to catch Promise rejections. If navigate
      // resolves without throwing, consider it a success and consume the pending.
      await navigate(pendingPath);
      try {
        consume();
      } catch {
        // swallow consumer errors but keep navigation successful
      }
      return true;
    } catch {
      // navigation failed; preserve pending and allow retry later
      return false;
    } finally {
      this.inFlight = false;
    }
  }
}
