import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_DELETION_ERROR,
  type AccountDeletionDependencies,
  handleAccountDeletion,
  isAllowedAccountDeletionOrigin,
  isOwnedAccountStorageObject,
} from "./deleteAccount";

const AUTH_USER_ID = "2d188df1-6842-4d41-a230-d7cb602f2253";
const OTHER_USER_ID = "5bd0bc5d-c2ac-48a2-bec0-5001d89b6c9b";

function createDependencies(
  overrides: Partial<AccountDeletionDependencies> = {},
): AccountDeletionDependencies {
  return {
    authenticate: vi.fn(async () => ({ userId: AUTH_USER_ID, email: "user@example.com" })),
    getHouseholds: vi.fn(async () => [{
      householdId: "3ba759c8-08ab-4555-b532-7d820f5ca92c",
      householdType: "individual",
      memberCount: 1,
      hasOtherMembers: false,
    }]),
    hasUnsafeHouseholdReferences: vi.fn(async () => false),
    getExternalConnectionIds: vi.fn(async () => []),
    revokeExternalConnections: vi.fn(async () => undefined),
    getStorageObjects: vi.fn(async () => []),
    removeStorageObjects: vi.fn(async () => undefined),
    deleteAuthUser: vi.fn(async () => undefined),
    ...overrides,
  };
}

function validRequest(bodyText = JSON.stringify({ confirmation: "EXCLUIR" })) {
  return {
    method: "POST",
    authorization: "Bearer valid.jwt.token",
    bodyText,
  };
}

describe("account deletion request boundary", () => {
  it("requires POST and a bearer token", async () => {
    const dependencies = createDependencies();

    await expect(handleAccountDeletion({
      ...validRequest(),
      method: "GET",
    }, dependencies)).resolves.toEqual({
      status: 405,
      body: { error: ACCOUNT_DELETION_ERROR.invalidMethod },
    });

    await expect(handleAccountDeletion({
      ...validRequest(),
      authorization: null,
    }, dependencies)).resolves.toEqual({
      status: 401,
      body: { error: ACCOUNT_DELETION_ERROR.unauthorized },
    });

    expect(dependencies.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    JSON.stringify({ userId: OTHER_USER_ID }),
    JSON.stringify({ user_id: OTHER_USER_ID }),
  ])("rejects a client-supplied user identifier", async (bodyText) => {
    const dependencies = createDependencies();

    await expect(handleAccountDeletion(validRequest(bodyText), dependencies)).resolves.toEqual({
      status: 400,
      body: { error: ACCOUNT_DELETION_ERROR.clientUserId },
    });

    expect(dependencies.authenticate).not.toHaveBeenCalled();
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });

  it.each(["userId", "user_id"])("rejects a client-supplied %s query", async (key) => {
    const dependencies = createDependencies();
    const request = {
      ...validRequest(),
      url: `https://example.supabase.co/functions/v1/delete-account?${key}=${OTHER_USER_ID}`,
    };

    await expect(handleAccountDeletion(request, dependencies)).resolves.toEqual({
      status: 400,
      body: { error: ACCOUNT_DELETION_ERROR.clientUserId },
    });

    expect(dependencies.authenticate).not.toHaveBeenCalled();
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("rejects malformed and unexpected bodies", async () => {
    const dependencies = createDependencies();

    for (const bodyText of [
      "",
      "not-json",
      "[]",
      JSON.stringify({ confirmation: "excluir" }),
      JSON.stringify({ confirmation: "EXCLUIR", unexpected: true }),
    ]) {
      const result = await handleAccountDeletion(validRequest(bodyText), dependencies);
      expect(result).toEqual({
        status: 400,
        body: { error: ACCOUNT_DELETION_ERROR.invalidRequest },
      });
    }
  });

  it("does not accept an identity that was not validated by Auth", async () => {
    const dependencies = createDependencies({ authenticate: vi.fn(async () => null) });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 401,
      body: { error: ACCOUNT_DELETION_ERROR.unauthorized },
    });

    expect(dependencies.getHouseholds).not.toHaveBeenCalled();
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });
});

describe("account deletion orchestration", () => {
  it("uses only the Auth identity, removes owned storage and deletes Auth last", async () => {
    const calls: string[] = [];
    const dependencies = createDependencies({
      authenticate: vi.fn(async (token) => {
        calls.push(`authenticate:${token}`);
        return { userId: AUTH_USER_ID, email: "user@example.com" };
      }),
      getHouseholds: vi.fn(async (userId) => {
        calls.push(`households:${userId}`);
        return [{
          householdId: "3ba759c8-08ab-4555-b532-7d820f5ca92c",
          householdType: "individual",
          memberCount: 1,
          hasOtherMembers: false,
        }];
      }),
      getStorageObjects: vi.fn(async (userId) => {
        calls.push(`storage:${userId}`);
        return [
          { bucketId: "avatars", objectName: `${AUTH_USER_ID}/avatar.webp` },
          {
            bucketId: "goal-photos",
            objectName: `3ba759c8-08ab-4555-b532-7d820f5ca92c/${AUTH_USER_ID}/goal/cover.webp`,
          },
        ];
      }),
      removeStorageObjects: vi.fn(async (bucketId) => {
        calls.push(`remove:${bucketId}`);
      }),
      deleteAuthUser: vi.fn(async (userId) => {
        calls.push(`delete:${userId}`);
      }),
    });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 200,
      body: { ok: true, deleted: true },
    });

    expect(calls).toEqual([
      "authenticate:valid.jwt.token",
      `households:${AUTH_USER_ID}`,
      `storage:${AUTH_USER_ID}`,
      "remove:avatars",
      "remove:goal-photos",
      `delete:${AUTH_USER_ID}`,
    ]);
  });

  it.each([
    { householdType: "shared", memberCount: 1, hasOtherMembers: false },
    { householdType: "individual", memberCount: 2, hasOtherMembers: true },
    { householdType: "individual", memberCount: 1, hasOtherMembers: true },
  ])("blocks a non-personal household before any mutation: %o", async (unsafeState) => {
    const dependencies = createDependencies({
      getHouseholds: vi.fn(async () => [{
        householdId: "3ba759c8-08ab-4555-b532-7d820f5ca92c",
        ...unsafeState,
      }]),
    });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 409,
      body: { error: ACCOUNT_DELETION_ERROR.unsafeHousehold },
    });

    expect(dependencies.getStorageObjects).not.toHaveBeenCalled();
    expect(dependencies.getExternalConnectionIds).not.toHaveBeenCalled();
    expect(dependencies.revokeExternalConnections).not.toHaveBeenCalled();
    expect(dependencies.removeStorageObjects).not.toHaveBeenCalled();
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("stops before Auth deletion if storage cleanup fails", async () => {
    const dependencies = createDependencies({
      getStorageObjects: vi.fn(async () => [{
        bucketId: "avatars",
        objectName: `${AUTH_USER_ID}/avatar.webp`,
      }]),
      removeStorageObjects: vi.fn(async () => {
        throw new Error("private infrastructure detail");
      }),
    });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 500,
      body: { error: ACCOUNT_DELETION_ERROR.failed },
    });

    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("blocks surviving-household references before any external cleanup", async () => {
    const dependencies = createDependencies({
      hasUnsafeHouseholdReferences: vi.fn(async () => true),
    });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 409,
      body: { error: ACCOUNT_DELETION_ERROR.unsafeHousehold },
    });
    expect(dependencies.getExternalConnectionIds).not.toHaveBeenCalled();
    expect(dependencies.getStorageObjects).not.toHaveBeenCalled();
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("revokes external provider items before Storage and Auth", async () => {
    const calls: string[] = [];
    const dependencies = createDependencies({
      getExternalConnectionIds: vi.fn(async () => {
        calls.push("lookup-external");
        return ["pluggy-item-1", "pluggy-item-1", "pluggy-item-2"];
      }),
      revokeExternalConnections: vi.fn(async (ids) => {
        calls.push(`revoke:${ids.join(",")}`);
      }),
      getStorageObjects: vi.fn(async () => {
        calls.push("lookup-storage");
        return [];
      }),
      deleteAuthUser: vi.fn(async () => {
        calls.push("delete-auth");
      }),
    });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 200,
      body: { ok: true, deleted: true },
    });
    expect(calls).toEqual([
      "lookup-external",
      "revoke:pluggy-item-1,pluggy-item-2",
      "lookup-storage",
      "delete-auth",
    ]);
  });

  it("does not mutate Storage or Auth when external revocation fails", async () => {
    const dependencies = createDependencies({
      getExternalConnectionIds: vi.fn(async () => ["pluggy-item"]),
      revokeExternalConnections: vi.fn(async () => {
        throw new Error("provider detail");
      }),
    });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 500,
      body: { error: ACCOUNT_DELETION_ERROR.failed },
    });
    expect(dependencies.getStorageObjects).not.toHaveBeenCalled();
    expect(dependencies.removeStorageObjects).not.toHaveBeenCalled();
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("fails closed when an external connection identifier is malformed", async () => {
    const dependencies = createDependencies({
      getExternalConnectionIds: vi.fn(async () => [null as unknown as string]),
    });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 500,
      body: { error: ACCOUNT_DELETION_ERROR.failed },
    });
    expect(dependencies.revokeExternalConnections).not.toHaveBeenCalled();
    expect(dependencies.getStorageObjects).not.toHaveBeenCalled();
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("returns only a generic error when final Auth deletion fails", async () => {
    const dependencies = createDependencies({
      deleteAuthUser: vi.fn(async () => {
        throw new Error("database constraint name");
      }),
    });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 500,
      body: { error: ACCOUNT_DELETION_ERROR.failed },
    });
  });

  it("fails closed if the server lookup returns a path outside the user's prefixes", async () => {
    const dependencies = createDependencies({
      getStorageObjects: vi.fn(async () => [{
        bucketId: "avatars",
        objectName: `${OTHER_USER_ID}/avatar.webp`,
      }]),
    });

    await expect(handleAccountDeletion(validRequest(), dependencies)).resolves.toEqual({
      status: 500,
      body: { error: ACCOUNT_DELETION_ERROR.failed },
    });

    expect(dependencies.removeStorageObjects).not.toHaveBeenCalled();
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });
});

describe("account deletion origin policy", () => {
  it("allows native requests without Origin and exact configured web origins", () => {
    expect(isAllowedAccountDeletionOrigin(null, undefined)).toBe(true);
    expect(isAllowedAccountDeletionOrigin(
      "https://app.sonhar.example",
      "https://admin.example, https://app.sonhar.example",
    )).toBe(true);
  });

  it("fails closed for an unconfigured or different web origin", () => {
    expect(isAllowedAccountDeletionOrigin("https://app.sonhar.example", undefined)).toBe(false);
    expect(isAllowedAccountDeletionOrigin(
      "https://evil.example",
      "https://app.sonhar.example",
    )).toBe(false);
  });
});

describe("account deletion storage ownership", () => {
  it("accepts only the two documented user path layouts", () => {
    expect(isOwnedAccountStorageObject({
      bucketId: "avatars",
      objectName: `${AUTH_USER_ID}/avatar.png`,
    }, AUTH_USER_ID)).toBe(true);
    expect(isOwnedAccountStorageObject({
      bucketId: "goal-photos",
      objectName: `household/${AUTH_USER_ID}/goal/cover.png`,
    }, AUTH_USER_ID)).toBe(true);
    expect(isOwnedAccountStorageObject({
      bucketId: "unknown",
      objectName: `${AUTH_USER_ID}/file.png`,
    }, AUTH_USER_ID)).toBe(false);
    expect(isOwnedAccountStorageObject({
      bucketId: "goal-photos",
      objectName: `household/${OTHER_USER_ID}/goal/cover.png`,
    }, AUTH_USER_ID)).toBe(false);
  });
});
