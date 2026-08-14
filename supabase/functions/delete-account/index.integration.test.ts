import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

type Handler = (request: Request) => Response | Promise<Response>;

const SUPABASE_URL = "https://project.example.test";
const PUBLISHABLE_KEY = "sb_publishable_default_integration";
const SECRET_KEY = "sb_secret_delete_account_integration";

async function loadHandler(values: Record<string, string | undefined>): Promise<{
  handler: Handler;
  environmentGet: ReturnType<typeof vi.fn>;
}> {
  let registeredHandler: Handler | undefined;
  const environmentGet = vi.fn((name: string) => values[name]);

  Object.defineProperty(globalThis, "Deno", {
    configurable: true,
    value: {
      env: { get: environmentGet },
      serve: (handler: Handler) => {
        registeredHandler = handler;
      },
    },
  });

  await import("./index");

  if (!registeredHandler) throw new Error("delete-account handler was not registered");
  return { handler: registeredHandler, environmentGet };
}

function request(): Request {
  return new Request(`${SUPABASE_URL}/functions/v1/delete-account`, {
    method: "POST",
    headers: {
      Authorization: "Bearer user-session-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirmation: "EXCLUIR" }),
  });
}

describe("delete-account API key environment integration", () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "Deno");
  });

  it("creates the user client with the named publishable key and admin with the named secret", async () => {
    createClientMock
      .mockReturnValueOnce({
        auth: {
          getUser: vi.fn(async () => ({ data: { user: null }, error: { status: 401 } })),
        },
      })
      .mockReturnValueOnce({});

    const { handler, environmentGet } = await loadHandler({
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
        default: PUBLISHABLE_KEY,
        "delete-account": "sb_publishable_not_selected_integration",
      }),
      SUPABASE_SECRET_KEYS: JSON.stringify({
        default: "sb_secret_default_integration",
        "delete-account": SECRET_KEY,
      }),
      SUPABASE_ANON_KEY: "legacy-publishable-marker",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-secret-marker",
    });

    const response = await handler(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(createClientMock).toHaveBeenNthCalledWith(
      1,
      SUPABASE_URL,
      PUBLISHABLE_KEY,
      expect.any(Object),
    );
    expect(createClientMock).toHaveBeenNthCalledWith(
      2,
      SUPABASE_URL,
      SECRET_KEY,
      expect.any(Object),
    );
    expect(environmentGet).not.toHaveBeenCalledWith("SUPABASE_ANON_KEY");
    expect(environmentGet).not.toHaveBeenCalledWith("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("fails closed when only default modern and legacy keys exist", async () => {
    const sensitiveMarker = "must-not-appear-in-response";
    const { handler, environmentGet } = await loadHandler({
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
        default: "sb_publishable_default_integration",
      }),
      SUPABASE_SECRET_KEYS: JSON.stringify({
        default: "sb_secret_default_integration",
      }),
      SUPABASE_ANON_KEY: sensitiveMarker,
      SUPABASE_SERVICE_ROLE_KEY: sensitiveMarker,
    });

    const response = await handler(request());
    const responseBody = await response.text();

    expect(response.status).toBe(500);
    expect(responseBody).toBe(JSON.stringify({ error: "account_deletion_failed" }));
    expect(responseBody).not.toContain(sensitiveMarker);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(environmentGet).not.toHaveBeenCalledWith("SUPABASE_ANON_KEY");
    expect(environmentGet).not.toHaveBeenCalledWith("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("fails closed when modern maps are absent even if legacy keys exist", async () => {
    const sensitiveMarker = "legacy-must-not-be-used-or-leaked";
    const { handler, environmentGet } = await loadHandler({
      SUPABASE_URL,
      SUPABASE_ANON_KEY: sensitiveMarker,
      SUPABASE_SERVICE_ROLE_KEY: sensitiveMarker,
    });

    const response = await handler(request());
    const responseBody = await response.text();

    expect(response.status).toBe(500);
    expect(responseBody).toBe(JSON.stringify({ error: "account_deletion_failed" }));
    expect(responseBody).not.toContain(sensitiveMarker);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(environmentGet).not.toHaveBeenCalledWith("SUPABASE_ANON_KEY");
    expect(environmentGet).not.toHaveBeenCalledWith("SUPABASE_SERVICE_ROLE_KEY");
  });
});
