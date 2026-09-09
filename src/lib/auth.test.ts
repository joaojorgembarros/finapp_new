import { describe, expect, it, vi } from "vitest";
import { passwordResetRedirectUrl } from "./auth";

vi.mock("expo-linking", () => ({
  // Expo SDK 54 appends the path as-is for a standalone custom scheme.
  createURL: (path: string) => `sonhomais://${path}`,
}));
vi.mock("./supabase", () => ({
  supabase: {},
}));

describe("passwordResetRedirectUrl", () => {
  it("builds the standalone reset redirect without a leading slash", () => {
    const url = passwordResetRedirectUrl();
    expect(url).toBe("sonhomais://reset-password");
    expect(url).not.toBe("sonhomais:///reset-password");
  });
});
