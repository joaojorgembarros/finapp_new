export function parseRecoveryUrl(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const fragment = (u.hash || "").startsWith("#") ? u.hash.slice(1) : "";
    const params = fragment ? new URLSearchParams(fragment) : new URLSearchParams(u.search);

    // For custom schemes like sonhomais://reset-password the host may be the path.
    // new URL('sonhomais://reset-password') yields u.hostname = 'reset-password' and u.pathname = '/'.
    let pathname = u.pathname || "/";
    if ((pathname === "/" || pathname === "") && u.hostname) {
      pathname = `/${u.hostname}${u.pathname && u.pathname !== "/" ? u.pathname : ""}`;
    }

    return { pathname, params };
  } catch {
    try {
      const [base, frag] = (raw || "").split("#");
      const pathname = (base.split("://")[1] || "").split("?")[0] || "/";
      const params = new URLSearchParams(frag || (base.split("?")[1] || ""));
      return { pathname: pathname.startsWith("/") ? pathname : `/${pathname}`, params };
    } catch {
      return null;
    }
  }
}

export function extractTokensFromUrl(raw: string | null | undefined) {
  const parsed = parseRecoveryUrl(raw);
  if (!parsed) return null;
  const { pathname, params } = parsed;
  if (!pathname.includes("reset-password")) return null;
  const access = params.get("access_token");
  const refresh = params.get("refresh_token");
  if (!access && !refresh) return null;
  return { access, refresh };
}
