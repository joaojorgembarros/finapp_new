import { describe, it, expect } from "vitest";
import { parseRecoveryUrl, extractTokensFromUrl } from "./recoveryLink";

describe("recoveryLink parser", () => {
  it("parses fragment tokens", () => {
    const u = "sonhomais://reset-password#access_token=AT&refresh_token=RT&other=1";
    const parsed = parseRecoveryUrl(u);
    expect(parsed).not.toBeNull();
    expect(parsed?.pathname).toBe("/reset-password");
    expect(parsed?.params.get("access_token")).toBe("AT");
    expect(parsed?.params.get("refresh_token")).toBe("RT");
  });

  it("parses query tokens", () => {
    const u = "sonhomais://reset-password?access_token=AT&refresh_token=RT";
    const parsed = parseRecoveryUrl(u);
    expect(parsed).not.toBeNull();
    expect(parsed?.params.get("access_token")).toBe("AT");
  });

  it("returns null for unrelated paths", () => {
    const t = extractTokensFromUrl("sonhomais://open-finance#access_token=AT");
    expect(t).toBeNull();
  });

  it("extractTokensFromUrl returns tokens only for reset-password", () => {
    const t = extractTokensFromUrl("sonhomais://reset-password#access_token=AT&refresh_token=RT");
    expect(t).toEqual({ access: "AT", refresh: "RT" });
  });

  it("returns null when no tokens present", () => {
    const t = extractTokensFromUrl("sonhomais://reset-password");
    expect(t).toBeNull();
  });
});
