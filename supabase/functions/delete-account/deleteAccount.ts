export const ACCOUNT_DELETION_ERROR = {
  invalidMethod: "method_not_allowed",
  invalidRequest: "invalid_request",
  clientUserId: "client_user_id_not_allowed",
  unauthorized: "unauthorized",
  unsafeHousehold: "shared_household_not_supported",
  failed: "account_deletion_failed",
} as const;

const USER_ID_KEYS = new Set(["userId", "user_id"]);
const ALLOWED_BUCKETS = new Set(["avatars", "goal-photos"]);
const REQUIRED_CONFIRMATION = "EXCLUIR";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AccountDeletionErrorCode =
  (typeof ACCOUNT_DELETION_ERROR)[keyof typeof ACCOUNT_DELETION_ERROR];

export type AccountDeletionRequest = {
  method: string;
  authorization: string | null;
  bodyText: string;
  url?: string;
};

export type AccountDeletionHousehold = {
  householdId: string;
  householdType: string;
  memberCount: number;
  hasOtherMembers: boolean;
};

export type AccountDeletionStorageObject = {
  bucketId: string;
  objectName: string;
};

export type AccountDeletionDependencies = {
  authenticate: (accessToken: string) => Promise<{ userId: string; email: string | null } | null>;
  getHouseholds: (userId: string) => Promise<AccountDeletionHousehold[]>;
  hasUnsafeHouseholdReferences: (userId: string) => Promise<boolean>;
  getExternalConnectionIds: (userId: string) => Promise<string[]>;
  revokeExternalConnections: (externalConnectionIds: string[]) => Promise<void>;
  getStorageObjects: (userId: string) => Promise<AccountDeletionStorageObject[]>;
  removeStorageObjects: (bucketId: string, objectNames: string[]) => Promise<void>;
  deleteAuthUser: (userId: string) => Promise<void>;
};

export type AccountDeletionResult =
  | { status: 200; body: { ok: true; deleted: true } }
  | { status: 400 | 401 | 405 | 409 | 500; body: { error: AccountDeletionErrorCode } };

function errorResult(
  status: 400 | 401 | 405 | 409 | 500,
  error: AccountDeletionErrorCode,
): AccountDeletionResult {
  return { status, body: { error } };
}

function getBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

function validateRequestBody(bodyText: string): AccountDeletionResult | null {
  if (!bodyText.trim()) {
    return errorResult(400, ACCOUNT_DELETION_ERROR.invalidRequest);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return errorResult(400, ACCOUNT_DELETION_ERROR.invalidRequest);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return errorResult(400, ACCOUNT_DELETION_ERROR.invalidRequest);
  }

  const keys = Object.keys(parsed);

  if (keys.some((key) => USER_ID_KEYS.has(key))) {
    return errorResult(400, ACCOUNT_DELETION_ERROR.clientUserId);
  }

  if (
    keys.length !== 1
    || keys[0] !== "confirmation"
    || (parsed as { confirmation?: unknown }).confirmation !== REQUIRED_CONFIRMATION
  ) {
    return errorResult(400, ACCOUNT_DELETION_ERROR.invalidRequest);
  }

  return null;
}

function hasClientUserIdQuery(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const query = new URL(url).searchParams;
    return [...USER_ID_KEYS].some((key) => query.has(key));
  } catch {
    return true;
  }
}

export function isUnsafeAccountDeletionHousehold(
  household: AccountDeletionHousehold,
): boolean {
  return household.householdType !== "individual"
    || household.memberCount > 1
    || household.hasOtherMembers;
}

export function isAllowedAccountDeletionOrigin(
  origin: string | null,
  configuredOrigins: string | undefined,
): boolean {
  if (!origin) return true;
  if (!configuredOrigins) return false;

  let requestOrigin: string;

  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  return configuredOrigins.split(",").some((configuredOrigin) => {
    try {
      return new URL(configuredOrigin.trim()).origin === requestOrigin;
    } catch {
      return false;
    }
  });
}

export function isOwnedAccountStorageObject(
  storageObject: AccountDeletionStorageObject,
  userId: string,
): boolean {
  if (!ALLOWED_BUCKETS.has(storageObject.bucketId)) return false;

  const pathParts = storageObject.objectName.split("/");

  if (storageObject.bucketId === "avatars") {
    return pathParts.length >= 2 && pathParts[0] === userId;
  }

  return pathParts.length >= 3 && pathParts[1] === userId;
}

function groupStorageObjects(
  storageObjects: AccountDeletionStorageObject[],
): Map<string, string[]> {
  const grouped = new Map<string, Set<string>>();

  for (const storageObject of storageObjects) {
    const bucketObjects = grouped.get(storageObject.bucketId) ?? new Set<string>();
    bucketObjects.add(storageObject.objectName);
    grouped.set(storageObject.bucketId, bucketObjects);
  }

  return new Map(
    [...grouped.entries()].map(([bucketId, objectNames]) => [bucketId, [...objectNames]]),
  );
}

export async function handleAccountDeletion(
  request: AccountDeletionRequest,
  dependencies: AccountDeletionDependencies,
): Promise<AccountDeletionResult> {
  if (request.method.toUpperCase() !== "POST") {
    return errorResult(405, ACCOUNT_DELETION_ERROR.invalidMethod);
  }

  const bodyError = validateRequestBody(request.bodyText);
  if (bodyError) return bodyError;

  if (hasClientUserIdQuery(request.url)) {
    return errorResult(400, ACCOUNT_DELETION_ERROR.clientUserId);
  }

  const accessToken = getBearerToken(request.authorization);
  if (!accessToken) {
    return errorResult(401, ACCOUNT_DELETION_ERROR.unauthorized);
  }

  let identity: { userId: string; email: string | null } | null;

  try {
    identity = await dependencies.authenticate(accessToken);
  } catch {
    return errorResult(500, ACCOUNT_DELETION_ERROR.failed);
  }

  if (!identity || !UUID_PATTERN.test(identity.userId)) {
    return errorResult(401, ACCOUNT_DELETION_ERROR.unauthorized);
  }

  try {
    const households = await dependencies.getHouseholds(identity.userId);

    if (
      households.some(isUnsafeAccountDeletionHousehold)
      || await dependencies.hasUnsafeHouseholdReferences(identity.userId)
    ) {
      return errorResult(409, ACCOUNT_DELETION_ERROR.unsafeHousehold);
    }

    const externalConnectionIds = [
      ...new Set(await dependencies.getExternalConnectionIds(identity.userId)),
    ];

    if (externalConnectionIds.some((externalConnectionId) => (
      typeof externalConnectionId !== "string"
      || externalConnectionId.length < 1
      || externalConnectionId.length > 512
    ))) {
      return errorResult(500, ACCOUNT_DELETION_ERROR.failed);
    }

    if (externalConnectionIds.length > 0) {
      await dependencies.revokeExternalConnections(externalConnectionIds);
    }

    const storageObjects = await dependencies.getStorageObjects(identity.userId);

    if (storageObjects.some((storageObject) => (
      !isOwnedAccountStorageObject(storageObject, identity.userId)
    ))) {
      return errorResult(500, ACCOUNT_DELETION_ERROR.failed);
    }

    for (const [bucketId, objectNames] of groupStorageObjects(storageObjects)) {
      await dependencies.removeStorageObjects(bucketId, objectNames);
    }

    await dependencies.deleteAuthUser(identity.userId);

    return { status: 200, body: { ok: true, deleted: true } };
  } catch {
    return errorResult(500, ACCOUNT_DELETION_ERROR.failed);
  }
}
