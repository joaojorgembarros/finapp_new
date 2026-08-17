import { describe, it, expect, vi } from "vitest";
import { PendingRecoveryNavigator } from "./pendingRecoveryController";

describe("PendingRecoveryNavigator", () => {
  it("does not navigate when no pendingPath", async () => {
    const nav = new PendingRecoveryNavigator();
    const mockNav = vi.fn();
    const mockConsume = vi.fn();
    const res = await nav.tryNavigate({ pendingPath: null, loading: false, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: false, navigate: mockNav, consume: mockConsume });
    expect(res).toBe(false);
    expect(mockNav).not.toHaveBeenCalled();
  });

  it("navigates once when conditions satisfied and consumes pending", async () => {
    const nav = new PendingRecoveryNavigator();
    const mockNav = vi.fn().mockResolvedValue(undefined);
    const mockConsume = vi.fn().mockReturnValue("/reset-password");
    const res = await nav.tryNavigate({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: false, navigate: mockNav, consume: mockConsume });
    expect(res).toBe(true);
    expect(mockNav).toHaveBeenCalledTimes(1);
    expect(mockNav).toHaveBeenCalledWith("/reset-password");
    expect(mockConsume).toHaveBeenCalledTimes(1);
  });

  it("preserves pending when navigate throws", async () => {
    const nav = new PendingRecoveryNavigator();
    const mockNav = vi.fn().mockRejectedValue(new Error("boom"));
    const mockConsume = vi.fn();
    const res = await nav.tryNavigate({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: false, navigate: mockNav, consume: mockConsume });
    expect(res).toBe(false);
    expect(mockNav).toHaveBeenCalledTimes(1);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it("does not navigate while locked or privacyCovered", async () => {
    const nav = new PendingRecoveryNavigator();
    const mockNav = vi.fn();
    const mockConsume = vi.fn();
    const r1 = await nav.tryNavigate({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: true, locked: true, privacyCovered: false, navigate: mockNav, consume: mockConsume });
    const r2 = await nav.tryNavigate({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: true, navigate: mockNav, consume: mockConsume });
    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(mockNav).not.toHaveBeenCalled();
  });

  it("prevents concurrent navigations", async () => {
    const nav = new PendingRecoveryNavigator();
    let resolveFirst: () => void = () => {};
    const firstPromise = new Promise<void>((res) => { resolveFirst = res; });
    const mockNav = vi.fn().mockImplementation(() => firstPromise);
    const mockConsume = vi.fn();

    const p1 = nav.tryNavigate({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: false, navigate: mockNav, consume: mockConsume });
    // second call while first is in flight
    const p2 = nav.tryNavigate({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: false, navigate: mockNav, consume: mockConsume });

    // complete first
    resolveFirst();
    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(mockNav).toHaveBeenCalledTimes(1);
  });
});
