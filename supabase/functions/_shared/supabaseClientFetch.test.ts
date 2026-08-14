import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseSecretKeyFetch } from "./supabaseClientFetch";

describe("createSupabaseSecretKeyFetch", () => {
  it("remove apenas o Bearer gerado a partir da secret key moderna", async () => {
    const secretKey = "sb_secret_admin-key";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    const secureFetch = createSupabaseSecretKeyFetch(secretKey, fetchMock);

    await secureFetch("https://example.test/rest/v1/items", {
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
      },
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("apikey")).toBe(secretKey);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("preserva o JWT pessoal quando ele esta em Authorization", async () => {
    const secretKey = "sb_secret_admin-key";
    const userJwt = "header.payload.signature";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    const secureFetch = createSupabaseSecretKeyFetch(secretKey, fetchMock);

    await secureFetch("https://example.test/auth/v1/user", {
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${userJwt}`,
      },
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${userJwt}`);
  });

  it("keeps a personal JWT in Authorization and the publishable key in apikey", async () => {
    const publishableKey = "sb_publishable_auth-key";
    const userJwt = "header.payload.signature";
    let requestHeaders = new Headers();
    const fetchMock: typeof fetch = async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ id: "00000000-0000-4000-8000-000000000001" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createClient("https://project.example.test", publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { fetch: fetchMock },
    });

    await client.auth.getUser(userJwt);

    expect(requestHeaders.get("apikey")).toBe(publishableKey);
    expect(requestHeaders.get("Authorization")).toBe(`Bearer ${userJwt}`);
  });

  it("keeps a modern admin key only in apikey for Supabase admin requests", async () => {
    const secretKey = "sb_secret_admin-key";
    let requestHeaders = new Headers();
    const fetchMock: typeof fetch = async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createClient("https://project.example.test", secretKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { fetch: createSupabaseSecretKeyFetch(secretKey, fetchMock) },
    });

    await client.auth.admin.deleteUser("00000000-0000-4000-8000-000000000001");

    expect(requestHeaders.get("apikey")).toBe(secretKey);
    expect(requestHeaders.has("Authorization")).toBe(false);
  });
});
