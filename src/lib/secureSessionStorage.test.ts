import { describe, expect, it } from "vitest";
import {
  AsyncStringStorage,
  createInvalidatedSessionStorage,
  createSecureSessionStorage,
} from "./secureSessionStorageCore";

class MemoryStorage implements AsyncStringStorage {
  readonly values = new Map<string, string>();
  readonly setOrder: string[] = [];
  failSet: ((key: string, value: string) => Error | null) | null = null;

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    const failure = this.failSet?.(key, value);
    if (failure) throw failure;
    this.values.set(key, value);
    this.setOrder.push(key);
  }

  async removeItem(key: string) {
    this.values.delete(key);
  }
}

function createFixture(chunkCharacterLimit = 32) {
  const secure = new MemoryStorage();
  const legacy = new MemoryStorage();
  const storage = createSecureSessionStorage({
    secureStore: secure,
    legacyStore: legacy,
    chunkCharacterLimit,
    maxChunkCount: 512,
  });
  return { secure, legacy, storage };
}

function findKey(store: MemoryStorage, suffix: string) {
  const key = [...store.values.keys()].find((candidate) => candidate.endsWith(suffix));
  if (!key) throw new Error(`Missing test storage key ending in ${suffix}`);
  return key;
}

function storedChunkKeys(store: MemoryStorage) {
  return [...store.values.keys()].filter((key) => /\.slot-[ab]\.\d+$/.test(key));
}

describe("secure session storage", () => {
  it("never restores or rewrites a session tombstoned after account deletion", async () => {
    const base = new MemoryStorage();
    const deletedUsers = new Set(["deleted-user"]);
    const storage = createInvalidatedSessionStorage({
      storage: base,
      isInvalidatedUser: async (userId) => deletedUsers.has(userId),
    });
    const key = "sb-project-auth-token";
    const deletedSession = JSON.stringify({
      access_token: "late-token",
      user: { id: "deleted-user" },
    });

    await base.setItem(key, deletedSession);
    await expect(storage.getItem(key)).resolves.toBeNull();
    await storage.setItem(key, deletedSession);
    expect(await base.getItem(key)).toBeNull();

    const activeSession = JSON.stringify({ user: { id: "active-user" } });
    await storage.setItem(key, activeSession);
    await expect(storage.getItem(key)).resolves.toBe(activeSession);
  });

  it("splits and reconstructs a large Supabase session", async () => {
    const { secure, storage } = createFixture(40);
    const session = JSON.stringify({
      access_token: "a".repeat(2_400),
      refresh_token: "r".repeat(900),
      user: { id: "user-1", user_metadata: { dreams: Array(30).fill("Casa própria") } },
    });

    await storage.setItem("sb-project-auth-token", session);

    expect(storedChunkKeys(secure).length).toBeGreaterThan(10);
    await expect(storage.getItem("sb-project-auth-token")).resolves.toBe(session);
  });

  it("round-trips Unicode by chunking encoded UTF-8 bytes", async () => {
    const { storage } = createFixture(18);
    const session = JSON.stringify({
      name: "João 🌙",
      dreams: ["Viagem ao Japão 🗾", "家族", "Café em Paris"],
    });

    await storage.setItem("unicode-session", session);

    await expect(storage.getItem("unicode-session")).resolves.toBe(session);
  });

  it("publishes the manifest only after every chunk and ready slot metadata", async () => {
    const { secure, storage } = createFixture(16);

    await storage.setItem("ordered-session", "value".repeat(20));

    const manifestIndex = secure.setOrder.findIndex((key) => key.endsWith(".manifest"));
    const chunkIndexes = secure.setOrder
      .map((key, index) => (/\.slot-[ab]\.\d+$/.test(key) ? index : -1))
      .filter((index) => index >= 0);
    const slotMetadataIndexes = secure.setOrder
      .map((key, index) => (/\.slot-[ab]$/.test(key) ? index : -1))
      .filter((index) => index >= 0);

    expect(manifestIndex).toBeGreaterThan(Math.max(...chunkIndexes));
    expect(manifestIndex).toBeGreaterThan(Math.max(...slotMetadataIndexes));
  });

  it("fails closed when a chunk is corrupted instead of restoring a stale legacy value", async () => {
    const { secure, legacy, storage } = createFixture(20);
    const key = "corrupt-session";
    await legacy.setItem(key, "valid migrated value");
    await expect(storage.getItem(key)).resolves.toBe("valid migrated value");

    await legacy.setItem(key, "stale legacy value");
    const chunkKey = storedChunkKeys(secure)[0];
    const chunk = secure.values.get(chunkKey)!;
    secure.values.set(chunkKey, `${chunk[0] === "0" ? "1" : "0"}${chunk.slice(1)}`);

    await expect(storage.getItem(key)).resolves.toBeNull();
    expect(await legacy.getItem(key)).toBe("stale legacy value");
  });

  it("fails closed when the manifest is malformed", async () => {
    const { secure, storage } = createFixture();
    const key = "bad-manifest";
    await storage.setItem(key, "private session");
    secure.values.set(findKey(secure, ".manifest"), "{not-json");

    await expect(storage.getItem(key)).resolves.toBeNull();
  });

  it("migrates a legacy Unicode session once and deletes it only after verification", async () => {
    const { secure, legacy, storage } = createFixture(20);
    const key = "legacy-session";
    const value = "sessão antiga com emoji 🔐 e caracteres 漢字";
    await legacy.setItem(key, value);

    await expect(storage.getItem(key)).resolves.toBe(value);

    expect(await legacy.getItem(key)).toBeNull();
    expect(findKey(secure, ".migration-complete")).toBeTruthy();
    expect(findKey(secure, ".manifest")).toBeTruthy();

    await legacy.setItem(key, "must not be imported again");
    await storage.removeItem(key);
    await expect(storage.getItem(key)).resolves.toBeNull();
  });

  it("keeps the legacy value when migration is interrupted", async () => {
    const { secure, legacy, storage } = createFixture(12);
    const key = "interrupted-migration";
    const value = "legacy ".repeat(20);
    await legacy.setItem(key, value);
    secure.failSet = (physicalKey) =>
      physicalKey.endsWith(".slot-a.1") ? new Error("simulated secure write failure") : null;

    await expect(storage.getItem(key)).rejects.toThrow("simulated secure write failure");
    expect(await legacy.getItem(key)).toBe(value);

    secure.failSet = null;
    await expect(storage.getItem(key)).resolves.toBe(value);
    expect(await legacy.getItem(key)).toBeNull();
  });

  it("keeps the previously published session when a replacement write is interrupted", async () => {
    const { secure, storage } = createFixture(12);
    const key = "atomic-session";
    const original = "original session ".repeat(10);
    const replacement = "replacement session ".repeat(10);
    await storage.setItem(key, original);

    secure.failSet = (physicalKey) =>
      physicalKey.endsWith(".slot-b.1") ? new Error("simulated interruption") : null;

    await expect(storage.setItem(key, replacement)).rejects.toThrow("simulated interruption");
    secure.failSet = null;
    await expect(storage.getItem(key)).resolves.toBe(original);
  });

  it("removes the manifest, active and interrupted chunks, and legacy value", async () => {
    const { secure, legacy, storage } = createFixture(12);
    const key = "removed-session";
    await storage.setItem(key, "active value ".repeat(10));

    secure.failSet = (physicalKey) =>
      physicalKey.endsWith(".slot-b.1") ? new Error("simulated interruption") : null;
    await expect(storage.setItem(key, "new value ".repeat(12))).rejects.toThrow();
    secure.failSet = null;
    await legacy.setItem(key, "legacy residue");

    await storage.removeItem(key);

    expect([...secure.values.keys()].some((physicalKey) => physicalKey.endsWith(".manifest"))).toBe(false);
    expect([...secure.values.keys()].some((physicalKey) => physicalKey.includes(".slot-"))).toBe(false);
    expect(await legacy.getItem(key)).toBeNull();
    await expect(storage.getItem(key)).resolves.toBeNull();
  });
});
