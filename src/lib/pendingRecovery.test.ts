import { describe, it, expect } from "vitest";
import { shouldNavigatePendingRecovery } from "./pendingRecovery";

describe("shouldNavigatePendingRecovery", () => {
  it("returns false when no pendingPath", () => {
    expect(shouldNavigatePendingRecovery({ pendingPath: null, loading: false, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: false })).toBe(false);
  });

  it("returns false while loading", () => {
    expect(shouldNavigatePendingRecovery({ pendingPath: "/reset-password", loading: true, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: false })).toBe(false);
  });

  it("returns false when not authenticated", () => {
    expect(shouldNavigatePendingRecovery({ pendingPath: "/reset-password", loading: false, authenticated: false, protectedTreeMounted: true, locked: false, privacyCovered: false })).toBe(false);
  });

  it("returns false when protectedTreeMounted is false", () => {
    expect(shouldNavigatePendingRecovery({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: false, locked: false, privacyCovered: false })).toBe(false);
  });

  it("returns false when locked or privacyCovered", () => {
    expect(shouldNavigatePendingRecovery({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: true, locked: true, privacyCovered: false })).toBe(false);
    expect(shouldNavigatePendingRecovery({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: true })).toBe(false);
  });

  it("returns true when all conditions satisfied", () => {
    expect(shouldNavigatePendingRecovery({ pendingPath: "/reset-password", loading: false, authenticated: true, protectedTreeMounted: true, locked: false, privacyCovered: false })).toBe(true);
  });
});
