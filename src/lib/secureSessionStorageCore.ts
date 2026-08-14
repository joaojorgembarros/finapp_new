import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export interface AsyncStringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function storedSessionUserId(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as { user?: { id?: unknown } };
    return typeof parsed.user?.id === "string" ? parsed.user.id : null;
  } catch {
    return null;
  }
}

export function createInvalidatedSessionStorage(options: {
  storage: AsyncStringStorage;
  isInvalidatedUser: (userId: string) => Promise<boolean>;
}): AsyncStringStorage {
  return {
    getItem: async (key) => {
      const value = await options.storage.getItem(key);
      if (value === null) return null;
      const userId = storedSessionUserId(value);
      return userId && await options.isInvalidatedUser(userId) ? null : value;
    },
    setItem: async (key, value) => {
      const userId = storedSessionUserId(value);
      if (userId && await options.isInvalidatedUser(userId)) {
        await options.storage.removeItem(key);
        return;
      }
      await options.storage.setItem(key, value);
    },
    removeItem: (key) => options.storage.removeItem(key),
  };
}

export type SecureSessionStorageOptions = {
  secureStore: AsyncStringStorage;
  legacyStore: AsyncStringStorage;
  chunkCharacterLimit?: number;
  maxChunkCount?: number;
};

type Slot = "a" | "b";

type ValueDescriptor = {
  version: 1;
  slot: Slot;
  chunkCount: number;
  byteLength: number;
  checksum: string;
};

type SlotMetadata = Omit<ValueDescriptor, "slot"> & {
  state: "writing" | "ready";
};

type StoredValueState =
  | { kind: "missing" }
  | { kind: "corrupt" }
  | { kind: "value"; value: string; manifest: ValueDescriptor };

const STORAGE_FORMAT_VERSION = 1;
const DEFAULT_CHUNK_CHARACTER_LIMIT = 1_800;
const DEFAULT_MAX_CHUNK_COUNT = 128;
const MIGRATION_MARKER_VALUE = "1";
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
const HEX_PATTERN = /^[0-9a-f]*$/;

function storagePrefix(key: string) {
  return `sonhar.session.${bytesToHex(sha256(utf8ToBytes(key)))}`;
}

function manifestKey(key: string) {
  return `${storagePrefix(key)}.manifest`;
}

function migrationMarkerKey(key: string) {
  return `${storagePrefix(key)}.migration-complete`;
}

function slotMetadataKey(key: string, slot: Slot) {
  return `${storagePrefix(key)}.slot-${slot}`;
}

function chunkKey(key: string, slot: Slot, index: number) {
  return `${storagePrefix(key)}.slot-${slot}.${index}`;
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseManifest(raw: string, maxChunkCount: number): ValueDescriptor | null {
  const value = parseJson(raw);
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<ValueDescriptor>;
  if (
    candidate.version !== STORAGE_FORMAT_VERSION ||
    (candidate.slot !== "a" && candidate.slot !== "b") ||
    !isSafeIntegerInRange(candidate.chunkCount, 1, maxChunkCount) ||
    !isSafeIntegerInRange(candidate.byteLength, 0, Number.MAX_SAFE_INTEGER) ||
    typeof candidate.checksum !== "string" ||
    !CHECKSUM_PATTERN.test(candidate.checksum)
  ) {
    return null;
  }

  return candidate as ValueDescriptor;
}

function parseSlotMetadata(raw: string, maxChunkCount: number): SlotMetadata | null {
  const value = parseJson(raw);
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<SlotMetadata>;
  if (
    candidate.version !== STORAGE_FORMAT_VERSION ||
    (candidate.state !== "writing" && candidate.state !== "ready") ||
    !isSafeIntegerInRange(candidate.chunkCount, 1, maxChunkCount) ||
    !isSafeIntegerInRange(candidate.byteLength, 0, Number.MAX_SAFE_INTEGER) ||
    typeof candidate.checksum !== "string" ||
    !CHECKSUM_PATTERN.test(candidate.checksum)
  ) {
    return null;
  }

  return candidate as SlotMetadata;
}

function descriptorMatchesMetadata(descriptor: ValueDescriptor, metadata: SlotMetadata) {
  return (
    metadata.state === "ready" &&
    descriptor.version === metadata.version &&
    descriptor.chunkCount === metadata.chunkCount &&
    descriptor.byteLength === metadata.byteLength &&
    descriptor.checksum === metadata.checksum
  );
}

function checksum(bytes: Uint8Array) {
  return bytesToHex(sha256(bytes));
}

function encodeValue(value: string, chunkCharacterLimit: number, maxChunkCount: number) {
  const bytes = utf8ToBytes(value);
  const encoded = bytesToHex(bytes);
  const chunks: string[] = [];

  for (let offset = 0; offset < encoded.length; offset += chunkCharacterLimit) {
    chunks.push(encoded.slice(offset, offset + chunkCharacterLimit));
  }
  if (chunks.length === 0) chunks.push("");

  if (chunks.length > maxChunkCount) {
    throw new Error("Supabase session exceeds the secure storage capacity.");
  }

  return {
    chunks,
    byteLength: bytes.length,
    checksum: checksum(bytes),
  };
}

function serializeManifest(descriptor: ValueDescriptor) {
  return JSON.stringify(descriptor);
}

function serializeSlotMetadata(metadata: SlotMetadata) {
  return JSON.stringify(metadata);
}

export function createSecureSessionStorage({
  secureStore,
  legacyStore,
  chunkCharacterLimit = DEFAULT_CHUNK_CHARACTER_LIMIT,
  maxChunkCount = DEFAULT_MAX_CHUNK_COUNT,
}: SecureSessionStorageOptions): AsyncStringStorage {
  const normalizedChunkLimit = Math.floor(chunkCharacterLimit / 2) * 2;
  if (normalizedChunkLimit < 2) throw new Error("Secure session chunk size must be at least 2 characters.");
  if (!Number.isSafeInteger(maxChunkCount) || maxChunkCount < 1) {
    throw new Error("Secure session max chunk count must be a positive integer.");
  }

  const queues = new Map<string, Promise<void>>();

  function runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.finally(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return result;
  }

  async function readManifest(key: string) {
    const raw = await secureStore.getItem(manifestKey(key));
    if (raw === null) return { kind: "missing" as const, raw: null, manifest: null };
    const manifest = parseManifest(raw, maxChunkCount);
    return manifest
      ? { kind: "valid" as const, raw, manifest }
      : { kind: "corrupt" as const, raw, manifest: null };
  }

  async function readChunks(key: string, descriptor: ValueDescriptor) {
    const metadataRaw = await secureStore.getItem(slotMetadataKey(key, descriptor.slot));
    if (metadataRaw === null) return null;
    const metadata = parseSlotMetadata(metadataRaw, maxChunkCount);
    if (!metadata || !descriptorMatchesMetadata(descriptor, metadata)) return null;

    let encoded = "";
    for (let index = 0; index < descriptor.chunkCount; index += 1) {
      const chunk = await secureStore.getItem(chunkKey(key, descriptor.slot, index));
      if (
        chunk === null ||
        chunk.length > normalizedChunkLimit ||
        chunk.length % 2 !== 0 ||
        !HEX_PATTERN.test(chunk)
      ) {
        return null;
      }
      encoded += chunk;
    }

    if (encoded.length !== descriptor.byteLength * 2) return null;

    try {
      const bytes = hexToBytes(encoded);
      if (checksum(bytes) !== descriptor.checksum) return null;
      return bytesToUtf8(bytes);
    } catch {
      return null;
    }
  }

  async function readSecureValue(key: string): Promise<StoredValueState> {
    const manifestState = await readManifest(key);
    if (manifestState.kind === "missing") return { kind: "missing" };
    if (manifestState.kind === "corrupt") return { kind: "corrupt" };

    const value = await readChunks(key, manifestState.manifest);
    return value === null
      ? { kind: "corrupt" }
      : { kind: "value", value, manifest: manifestState.manifest };
  }

  async function deleteKeys(keys: string[]) {
    let firstError: unknown;
    for (const key of keys) {
      try {
        await secureStore.removeItem(key);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  async function removeSlot(key: string, slot: Slot, hintedChunkCount?: number) {
    const metadataKey = slotMetadataKey(key, slot);
    const metadataRaw = await secureStore.getItem(metadataKey);
    const metadata = metadataRaw === null ? null : parseSlotMetadata(metadataRaw, maxChunkCount);
    const corruptMetadataNeedsSweep = metadataRaw !== null && metadata === null;
    const chunkCount = corruptMetadataNeedsSweep
      ? maxChunkCount
      : Math.max(metadata?.chunkCount ?? 0, hintedChunkCount ?? 0);
    const keys = Array.from({ length: chunkCount }, (_, index) => chunkKey(key, slot, index));
    keys.push(metadataKey);
    await deleteKeys(keys);
  }

  async function writeSecureValue(key: string, value: string) {
    const previous = await readManifest(key);
    const nextSlot: Slot = previous.kind === "valid" && previous.manifest.slot === "a" ? "b" : "a";
    const encoded = encodeValue(value, normalizedChunkLimit, maxChunkCount);
    const descriptor: ValueDescriptor = {
      version: STORAGE_FORMAT_VERSION,
      slot: nextSlot,
      chunkCount: encoded.chunks.length,
      byteLength: encoded.byteLength,
      checksum: encoded.checksum,
    };
    const metadataWithoutSlot: SlotMetadata = {
      version: descriptor.version,
      state: "writing",
      chunkCount: descriptor.chunkCount,
      byteLength: descriptor.byteLength,
      checksum: descriptor.checksum,
    };

    await removeSlot(key, nextSlot);
    await secureStore.setItem(
      slotMetadataKey(key, nextSlot),
      serializeSlotMetadata(metadataWithoutSlot),
    );
    for (let index = 0; index < encoded.chunks.length; index += 1) {
      await secureStore.setItem(chunkKey(key, nextSlot, index), encoded.chunks[index]);
    }

    const readyMetadata: SlotMetadata = { ...metadataWithoutSlot, state: "ready" };
    await secureStore.setItem(slotMetadataKey(key, nextSlot), serializeSlotMetadata(readyMetadata));

    const stagedValue = await readChunks(key, descriptor);
    if (stagedValue !== value) throw new Error("Secure session verification failed before publishing.");

    await secureStore.setItem(manifestKey(key), serializeManifest(descriptor));
    const published = await readSecureValue(key);
    if (published.kind !== "value" || published.value !== value) {
      if (previous.kind === "valid") {
        await secureStore.setItem(manifestKey(key), previous.raw);
      } else {
        await secureStore.removeItem(manifestKey(key));
      }
      throw new Error("Secure session verification failed after publishing.");
    }

    if (previous.kind === "valid" && previous.manifest.slot !== nextSlot) {
      try {
        await removeSlot(key, previous.manifest.slot, previous.manifest.chunkCount);
      } catch {
        // The newly published value is already valid. A later write/removal retries cleanup.
      }
    }
  }

  async function markMigrationComplete(key: string) {
    const markerKey = migrationMarkerKey(key);
    if ((await secureStore.getItem(markerKey)) !== MIGRATION_MARKER_VALUE) {
      await secureStore.setItem(markerKey, MIGRATION_MARKER_VALUE);
    }
  }

  async function removeLegacyBestEffort(key: string) {
    try {
      await legacyStore.removeItem(key);
    } catch {
      // The marker prevents a stale legacy copy from being restored. A later access retries cleanup.
    }
  }

  async function getItemUnlocked(key: string) {
    const secureValue = await readSecureValue(key);
    if (secureValue.kind === "value") {
      await markMigrationComplete(key);
      await removeLegacyBestEffort(key);
      return secureValue.value;
    }

    if (secureValue.kind === "corrupt") {
      await markMigrationComplete(key);
      return null;
    }

    const migrationMarker = await secureStore.getItem(migrationMarkerKey(key));
    if (migrationMarker !== null) {
      await removeLegacyBestEffort(key);
      return null;
    }

    const legacyValue = await legacyStore.getItem(key);
    if (legacyValue === null) {
      await markMigrationComplete(key);
      return null;
    }

    await writeSecureValue(key, legacyValue);
    const migrated = await readSecureValue(key);
    if (migrated.kind !== "value" || migrated.value !== legacyValue) {
      throw new Error("Secure session migration verification failed.");
    }

    await markMigrationComplete(key);
    await legacyStore.removeItem(key);
    return migrated.value;
  }

  async function removeItemUnlocked(key: string) {
    const manifestState = await readManifest(key);
    let markerReady = false;
    let legacyRemoved = false;
    let markerError: unknown;
    let legacyError: unknown;

    try {
      await markMigrationComplete(key);
      markerReady = true;
    } catch (error) {
      markerError = error;
    }

    try {
      await legacyStore.removeItem(key);
      legacyRemoved = true;
    } catch (error) {
      legacyError = error;
    }

    if (!markerReady && !legacyRemoved) {
      throw markerError ?? legacyError ?? new Error("Could not make secure session removal durable.");
    }

    const manifestHint = manifestState.kind === "valid" ? manifestState.manifest : null;
    // Removing the published manifest makes all chunks unreachable. Unlike
    // residue cleanup below, failure here must be surfaced to the auth client.
    await secureStore.removeItem(manifestKey(key));

    for (const slot of ["a", "b"] as const) {
      try {
        await removeSlot(
          key,
          slot,
          manifestHint?.slot === slot ? manifestHint.chunkCount : undefined,
        );
      } catch {
        // The manifest is gone and the migration marker prevents resurrection.
        // A future write/removal will retry physical residue cleanup.
      }
    }
  }

  return {
    getItem: (key) => runExclusive(key, () => getItemUnlocked(key)),
    setItem: (key, value) =>
      runExclusive(key, async () => {
        await writeSecureValue(key, value);
        await markMigrationComplete(key);
        await removeLegacyBestEffort(key);
      }),
    removeItem: (key) => runExclusive(key, () => removeItemUnlocked(key)),
  };
}
