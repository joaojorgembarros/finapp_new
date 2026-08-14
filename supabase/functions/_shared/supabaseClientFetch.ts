type FetchImplementation = typeof fetch;

/**
 * supabase-js currently supplies its API key as a Bearer token when no user
 * session exists. Modern secret keys are API keys, not JWTs, so keep them on
 * the SDK-provided `apikey` header and remove only that generated Bearer value.
 * Explicit user JWTs remain untouched.
 */
export function createSupabaseSecretKeyFetch(
  secretKey: string,
  fetchImplementation: FetchImplementation = fetch,
): FetchImplementation {
  return async (input, init) => {
    const headers = new Headers(init?.headers);

    if (headers.get("Authorization") === `Bearer ${secretKey}`) {
      headers.delete("Authorization");
    }

    return fetchImplementation(input, { ...init, headers });
  };
}
