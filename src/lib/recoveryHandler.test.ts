import { describe, it, expect, vi } from "vitest";
import { processRecoveryUrl, bootstrapInitialRecovery, setupLinkingListener, initialRecoveryThenRestore, DedupeState } from "./recoveryHandler";

function makeMockSupabase() {
  const setSession = vi.fn();
  const getSession = vi.fn();
  return { auth: { setSession, getSession } };
}

describe("recoveryHandler", () => {
  it("processes URL with fragment tokens and calls setSession/getSession", async () => {
    const supabase = makeMockSupabase();
    supabase.auth.setSession.mockResolvedValue({});
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    const dedupe: DedupeState = {};
    const res = await processRecoveryUrl(supabase as any, "sonhomais://reset-password#access_token=AT&refresh_token=RT", dedupe);
    expect(res.processed).toBe(true);
    expect(supabase.auth.setSession).toHaveBeenCalledTimes(1);
    expect(supabase.auth.setSession).toHaveBeenCalledWith({ access_token: "AT", refresh_token: "RT" });
    expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
  });

  it("skips URL without tokens", async () => {
    const supabase = makeMockSupabase();
    const dedupe: DedupeState = {};
    const res = await processRecoveryUrl(supabase as any, "sonhomais://reset-password", dedupe);
    expect(res.processed).toBe(false);
  });

  it("does not process other app URLs", async () => {
    const supabase = makeMockSupabase();
    const dedupe: DedupeState = {};
    const res = await processRecoveryUrl(supabase as any, "sonhomais://open-finance#access_token=AT", dedupe);
    expect(res.processed).toBe(false);
  });

  it("deduplicates immediate repeated links and allows retry after failure", async () => {
    const supabase = makeMockSupabase();
    // first call rejects
    supabase.auth.setSession.mockRejectedValueOnce(new Error("bad token"));
    // second call resolves
    supabase.auth.setSession.mockResolvedValueOnce({});
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    const dedupe: DedupeState = {};
    const url = "sonhomais://reset-password#access_token=AT&refresh_token=RT";
    // first attempt fails
    const r1 = await processRecoveryUrl(supabase as any, url, dedupe, { now: () => 1000 });
    expect(r1.processed).toBe(false);
    expect((dedupe as any).lastSig).toBeUndefined();

    // immediate retry within inflight window should process now since inFlight cleared after failure
    const r2 = await processRecoveryUrl(supabase as any, url, dedupe, { now: () => 1005 });
    expect(r2.processed).toBe(true);
    expect((dedupe as any).lastSig).toBeDefined();

    // different later
    const r3 = await processRecoveryUrl(supabase as any, url, dedupe, { now: () => 12_000 });
    // should process again after 10s window
    expect(r3.processed).toBe(true);
  });

  it("bootstrapInitialRecovery uses Linking.getInitialURL", async () => {
    const supabase = makeMockSupabase();
    supabase.auth.setSession.mockResolvedValue({});
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    const LinkingMock = { getInitialURL: vi.fn().mockResolvedValue("sonhomais://reset-password#access_token=AT&refresh_token=RT") };
    const dedupe: DedupeState = {};
    const r = await bootstrapInitialRecovery(supabase as any, LinkingMock, dedupe);
    expect(r.processed).toBe(true);
    expect(LinkingMock.getInitialURL).toHaveBeenCalled();
  });

  it("initialRecoveryThenRestore orders bootstrap before final getSession", async () => {
    const calls: string[] = [];
    const supabase: any = {
      auth: {
        setSession: vi.fn(async () => { calls.push("set"); return {}; }),
        getSession: vi.fn(async () => {
          calls.push("get");
          return { data: { session: { user: { id: "u1" } } } };
        }),
      },
    };
    const LinkingMock = { getInitialURL: vi.fn().mockResolvedValue("sonhomais://reset-password#access_token=AT&refresh_token=RT") };
    const dedupe: DedupeState = {};
    const session = await initialRecoveryThenRestore(supabase, LinkingMock, dedupe);
    expect(session).not.toBeNull();
    // ensure setSession called before getSession
    expect(calls[0]).toBe("set");
    expect(calls[1]).toBe("get");
  });

  it("does not call setSession when url contains supabase error params", async () => {
    const supabase = makeMockSupabase();
    const dedupe: DedupeState = {};
    const res = await processRecoveryUrl(supabase as any, "sonhomais://reset-password#error=access_denied&error_description=bad%20scope", dedupe);
    expect(res.processed).toBe(false);
    expect(res.reason).toBe("supabase_error");
    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });

  it("does not leak tokens or urls to console", async () => {
    const supabase = makeMockSupabase();
    supabase.auth.setSession.mockResolvedValue({});
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const dedupe: DedupeState = {};
    const url = "sonhomais://reset-password#access_token=AT&refresh_token=RT";
    const res = await processRecoveryUrl(supabase as any, url, dedupe);
    expect(res.processed).toBe(true);
    // Ensure none of the console calls contain raw tokens or the full URL
    for (const spy of [warn, log, error]) {
      for (const call of spy.mock.calls) {
        const joined = call.join(" ");
        expect(joined).not.toContain("AT");
        expect(joined).not.toContain("RT");
        expect(joined).not.toContain("access_token");
        expect(joined).not.toContain(url);
      }
    }

    warn.mockRestore();
    log.mockRestore();
    error.mockRestore();
  });

  it("initialRecoveryThenRestore continues when getInitialURL returns null", async () => {
    const calls: string[] = [];
    const supabase: any = {
      auth: {
        setSession: vi.fn(async () => { calls.push("set"); return {}; }),
        getSession: vi.fn(async () => {
          calls.push("get");
          return { data: { session: { user: { id: "u1" } } } };
        }),
      },
    };
    const LinkingMock = { getInitialURL: vi.fn().mockResolvedValue(null) };
    const dedupe: DedupeState = {};
    const session = await initialRecoveryThenRestore(supabase, LinkingMock, dedupe);
    expect(session).not.toBeNull();
    // should call getSession at least once
    expect(calls).toContain("get");
  });

  it("setupLinkingListener registers and returns cleanup that removes listener", () => {
    const listener = vi.fn();
    const remove = vi.fn();
    const LinkingMock = { addEventListener: vi.fn(() => ({ remove })) };
    const cleanup = setupLinkingListener(LinkingMock, listener as any);
    expect(LinkingMock.addEventListener).toHaveBeenCalledWith("url", expect.any(Function));
    cleanup();
    expect(remove).toHaveBeenCalled();
  });

  it("reports error when setSession fails", async () => {
    const supabase = makeMockSupabase();
    supabase.auth.setSession.mockRejectedValue(new Error("bad token"));
    const dedupe: DedupeState = {};
    const res = await processRecoveryUrl(supabase as any, "sonhomais://reset-password#access_token=AT", dedupe);
    expect(res.processed).toBe(false);
    expect(res.error).toBeDefined();
  });
});
