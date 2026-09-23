const providerUrl = import.meta.env.VITE_OAUTH_PROVIDER_URL;
const attemptKey = "dzenanalyticsOAuthAttempt";

export function isOAuthConfigured(): boolean {
  return !!providerUrl && !__STANDALONE__;
}

export function startOAuth(): void {
  if (!isOAuthConfigured()) return;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const state = `${location.hostname.split(".")[0]}:${nonce}`;
  sessionStorage.setItem(attemptKey, JSON.stringify({ state, expiresAt: Date.now() + 600_000 }));
  const url = new URL("/auth", providerUrl);
  url.searchParams.set("state", state);
  location.assign(url.href);
}

export function consumeOAuthCallback(): { code: string } | { error: true } | null {
  if (location.pathname !== "/oauth/callback") return null;
  const params = new URLSearchParams(location.search);
  history.replaceState(null, "", "/settings?source=api");
  const pending = sessionStorage.getItem(attemptKey);
  sessionStorage.removeItem(attemptKey);
  try {
    if (!isOAuthConfigured()) return { error: true };
    const attempt = JSON.parse(pending ?? "null");
    if (!attempt || typeof attempt.state !== "string" || !(attempt.expiresAt > Date.now()) ||
      params.getAll("state").length !== 1 || params.get("state") !== attempt.state ||
      params.has("error") || params.getAll("code").length !== 1 || !params.get("code")) return { error: true };
    return { code: params.get("code")! };
  } catch {
    return { error: true };
  }
}

export async function exchangeCode(code: string): Promise<string> {
  if (!isOAuthConfigured()) throw new Error("OAuth is not configured");
  const response = await fetch(new URL("/exchange", providerUrl), {
    method: "POST", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Не удалось завершить вход. Попробуйте снова.");
  const result = await response.json();
  if (typeof result?.accessToken !== "string" || !result.accessToken) throw new Error("Некорректный ответ входа");
  return result.accessToken;
}
