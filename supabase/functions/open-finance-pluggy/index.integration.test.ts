import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

type Handler = (request: Request) => Response | Promise<Response>;

type TestRuntime = {
  env: { get: ReturnType<typeof vi.fn> };
  serve: (handler: Handler) => void;
};

const OPEN_FINANCE_SECRET = "sb_secret_open_finance_integration";
const LOCAL_SINGLE_SECRET = "sb_secret_local_cli_integration";
const LEAK_MARKER = "legacy-value-must-never-leak";

function installRuntime(values: Record<string, string | undefined>) {
  let handler: Handler | null = null;
  const envGet = vi.fn((name: string) => values[name]);
  const runtime: TestRuntime = {
    env: { get: envGet },
    serve: (nextHandler) => {
      handler = nextHandler;
    },
  };

  (globalThis as typeof globalThis & { Deno: TestRuntime }).Deno = runtime;

  return {
    envGet,
    getHandler: () => {
      if (!handler) throw new Error("handler was not registered");
      return handler;
    },
  };
}

function validEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    SUPABASE_URL: "https://project.example.test",
    SUPABASE_SECRET_KEYS: JSON.stringify({
      default: "sb_secret_default_integration",
      "open-finance": OPEN_FINANCE_SECRET,
    }),
    PLUGGY_CLIENT_ID: "pluggy-client-id",
    PLUGGY_CLIENT_SECRET: "pluggy-client-secret",
    ...overrides,
  };
}

function createAdminClientResult(options: {
  user?: { id: string } | null;
  authError?: Error | null;
} = {}) {
  const getUser = vi.fn(async () => ({
    data: { user: options.user ?? null },
    error: options.authError ?? null,
  }));

  return {
    auth: { getUser },
    getUser,
  };
}

async function loadHandler(
  values: Record<string, string | undefined>,
  clientResult = createAdminClientResult(),
) {
  const runtime = installRuntime(values);
  createClientMock.mockReturnValue(clientResult);
  await import("./index");
  return { ...runtime, handler: runtime.getHandler(), clientResult };
}

describe("open-finance-pluggy modern Supabase credentials", () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
  });

  it("selects only the explicitly named modern secret key", async () => {
    const { handler } = await loadHandler(validEnvironment());
    const response = await handler(new Request(
      "https://project.example.test/functions/v1/open-finance-pluggy/connections",
    ));

    expect(response.status).toBe(401);
    expect(createClientMock).toHaveBeenCalledWith(
      "https://project.example.test",
      OPEN_FINANCE_SECRET,
      expect.objectContaining({
        global: { fetch: expect.any(Function) },
      }),
    );
  });

  it("fails closed when the modern named secret is absent and ignores legacy env", async () => {
    const { handler, envGet } = await loadHandler(validEnvironment({
      SUPABASE_SECRET_KEYS: JSON.stringify({
        default: "sb_secret_default_integration",
      }),
      SUPABASE_SERVICE_ROLE_KEY: LEAK_MARKER,
    }));
    const response = await handler(new Request(
      "https://project.example.test/functions/v1/open-finance-pluggy/connections",
    ));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(envGet).not.toHaveBeenCalledWith("SUPABASE_SERVICE_ROLE_KEY");
    expect(body).not.toContain(LEAK_MARKER);
  });

  it("accepts the official single modern key only for an explicit local CLI fallback", async () => {
    const { handler, envGet } = await loadHandler(validEnvironment({
      SUPABASE_URL: "http://kong:8000",
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: LOCAL_SINGLE_SECRET }),
      OPEN_FINANCE_LOCAL_SINGLE_SECRET_KEY_FALLBACK: "true",
      SUPABASE_SERVICE_ROLE_KEY: LEAK_MARKER,
    }));
    const response = await handler(new Request(
      "http://127.0.0.1:54321/functions/v1/open-finance-pluggy/connections",
    ));

    expect(response.status).toBe(401);
    expect(createClientMock).toHaveBeenCalledWith(
      "http://kong:8000",
      LOCAL_SINGLE_SECRET,
      expect.objectContaining({
        global: { fetch: expect.any(Function) },
      }),
    );
    expect(envGet).not.toHaveBeenCalledWith("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("refuses the single-key fallback outside the local Supabase runtime", async () => {
    const { handler } = await loadHandler(validEnvironment({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: LOCAL_SINGLE_SECRET }),
      OPEN_FINANCE_LOCAL_SINGLE_SECRET_KEY_FALLBACK: "true",
    }));
    const response = await handler(new Request(
      "https://project.example.test/functions/v1/open-finance-pluggy/connections",
    ));

    expect(response.status).toBe(500);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("requires the personal Bearer token before any administrative request", async () => {
    const { handler, clientResult } = await loadHandler(validEnvironment());
    const response = await handler(new Request(
      "https://project.example.test/functions/v1/open-finance-pluggy/connections?householdId=h1",
    ));

    expect(response.status).toBe(401);
    expect(clientResult.getUser).not.toHaveBeenCalled();
  });

  it("validates the personal Bearer token with auth.getUser", async () => {
    const clientResult = createAdminClientResult({ authError: new Error("invalid session") });
    const { handler } = await loadHandler(validEnvironment(), clientResult);
    const response = await handler(new Request(
      "https://project.example.test/functions/v1/open-finance-pluggy/connections?householdId=h1",
      { headers: { Authorization: "Bearer personal-user-jwt" } },
    ));

    expect(response.status).toBe(401);
    expect(clientResult.getUser).toHaveBeenCalledWith("personal-user-jwt");
  });

  it("reports missing modern configuration without exposing legacy values", async () => {
    const { handler } = await loadHandler(validEnvironment({
      SUPABASE_SECRET_KEYS: undefined,
      SUPABASE_SERVICE_ROLE_KEY: LEAK_MARKER,
    }));
    const response = await handler(new Request(
      "https://project.example.test/functions/v1/open-finance-pluggy/config",
    ));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"configured":false');
    expect(body).not.toContain(LEAK_MARKER);
  });

  it("exposes the updated Sonho+ OAuth redirect URI in diagnostics and excludes legacy scheme", async () => {
    const { handler } = await loadHandler(validEnvironment());
    const response = await handler(new Request(
      "https://project.example.test/functions/v1/open-finance-pluggy/config",
    ));
    const data = (await response.json()) as { diagnostics: { code: string; message: string }[] };

    expect(response.status).toBe(200);
    const redirectCheck = data.diagnostics.find((item) => item.code === "backend_oauth_redirect");
    expect(redirectCheck?.message).toBe("oauthRedirectUri configurado como sonhomais://open-finance.");
    expect(JSON.stringify(data)).not.toContain("finapp://open-finance");
  });
});
