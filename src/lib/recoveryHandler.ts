import { parseRecoveryUrl } from "./recoveryLink";

// Simple JS FNV-1a 32-bit hash for dedup fingerprinting (in-memory only).
function fnv1a32(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h >>> 0) * 0x01000193;
    h >>>= 0;
  }
  return (h >>> 0).toString(36);
}

type SupabaseLike = { auth: { setSession: (p: any) => Promise<unknown>; getSession: () => Promise<any> } };

export type DedupeState = { lastSig?: string | null; lastAt?: number | null; inFlightSig?: string | null };

export async function processRecoveryUrl(supabaseClient: SupabaseLike, rawUrl: string | null | undefined, dedupe: DedupeState, opts?: { now?: () => number }) {
  if (!rawUrl) return { processed: false };
  const parsed = parseRecoveryUrl(rawUrl);
  if (!parsed) return { processed: false };
  const { pathname, params } = parsed;
  if (!pathname.includes("reset-password")) return { processed: false };

  // If Supabase sign-in page returned an error in the params, do not proceed.
  if (params.get("error") || params.get("error_code") || params.get("error_description")) {
    return { processed: false, reason: "supabase_error" };
  }

  const access = params.get("access_token") ?? undefined;
  const refresh = params.get("refresh_token") ?? undefined;
  if (!access && !refresh) return { processed: false };

  const now = (opts && opts.now ? opts.now() : Date.now());
  const sigBase = `${pathname}|${access ?? ""}|${refresh ?? ""}`;
  const sig = fnv1a32(sigBase);

  // Prevent concurrent double-processing: if this signature is already in-flight, skip.
  if ((dedupe as any).inFlightSig === sig) {
    return { processed: false, reason: "inflight" };
  }

  // Deduplicate immediate duplicates: if same signature processed within 10s, skip.
  if (dedupe.lastSig === sig && dedupe.lastAt && now - dedupe.lastAt < 10_000) {
    return { processed: false, reason: "duplicate" };
  }

  // Mark in-flight before attempting network operation; do not mark lastSig/lastAt until success.
  (dedupe as any).inFlightSig = sig;

  try {
    const payload: Record<string, string> = {};
    if (typeof access === "string") payload.access_token = access;
    if (typeof refresh === "string") payload.refresh_token = refresh;

    await supabaseClient.auth.setSession(payload as any);

    const sessionResp = await supabaseClient.auth.getSession();

    // Successful processing -> update dedupe last success metadata and clear inFlight
    dedupe.lastSig = sig;
    dedupe.lastAt = now;
    (dedupe as any).inFlightSig = null;

    return { processed: true, session: sessionResp?.data?.session ?? null };
  } catch (e) {
    // Do not leak tokens or URL. Only generic developer-facing warning allowed.
    try {
      if ((global as any).__DEV__) console.warn("Could not establish session from recovery link.");
    } catch {}

    // Clear inFlight so future attempts can retry
    (dedupe as any).inFlightSig = null;

    return { processed: false, error: e };
  }
}

export async function bootstrapInitialRecovery(supabaseClient: SupabaseLike, LinkingLike: any, dedupe: DedupeState) {
  try {
    const initial = await LinkingLike.getInitialURL();
    if (initial) {
      const r = await processRecoveryUrl(supabaseClient, initial, dedupe);
      return r;
    }
    return { processed: false };
  } catch {
    return { processed: false };
  }
}

export async function initialRecoveryThenRestore(supabaseClient: SupabaseLike, LinkingLike: any, dedupe: DedupeState) {
  // bootstrap (may call setSession)
  await bootstrapInitialRecovery(supabaseClient, LinkingLike, dedupe);
  // then restore final session state from storage / supabase
  const sessionResp = await supabaseClient.auth.getSession();
  return sessionResp?.data?.session ?? null;
}

export function setupLinkingListener(LinkingLike: any, handler: (url: string) => Promise<any>) {
  const sub = LinkingLike.addEventListener("url", (evt: any) => handler(evt.url));
  return () => {
    try { sub.remove(); } catch { /* noop */ }
  };
}
