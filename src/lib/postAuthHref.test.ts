import { describe, expect, it } from "vitest";
import { getPostAuthHref } from "./postAuthHref";

function sessionWithMetadata(metadata: Record<string, unknown>) {
  return {
    user: { user_metadata: metadata },
  } as Parameters<typeof getPostAuthHref>[0];
}

describe("getPostAuthHref", () => {
  it("sends unauthenticated users to login", () => {
    expect(getPostAuthHref(null)).toBe("/(auth)/login");
  });

  it("sends completed onboarding to the journey", () => {
    expect(getPostAuthHref(sessionWithMetadata({
      new_onboarding_done: true,
      finapp_dreams: ["Casa"],
    }))).toBe("/(app)/journey");
  });

  it("resumes the financial-situation onboarding step", () => {
    expect(getPostAuthHref(sessionWithMetadata({
      new_onboarding_step: "financial-situation",
      finapp_dreams: ["Casa"],
    }))).toBe("/(onboarding)/financial-situation");
  });

  it("starts onboarding dreams when the account is authenticated but incomplete", () => {
    expect(getPostAuthHref(sessionWithMetadata({}))).toBe("/(onboarding)/dreams");
  });
});
