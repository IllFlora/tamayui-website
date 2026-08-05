import { HttpError } from "./http.js";

const keyCache = new Map();
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function normalizeTeamDomain(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

async function getVerificationKey(teamDomain, kid) {
  const cached = keyCache.get(`${teamDomain}:${kid}`);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!response.ok) throw new HttpError(401, "認証情報を確認できませんでした。", "access_key_error");

  const body = await response.json();
  const jwk = body.keys?.find((candidate) => candidate.kid === kid);
  if (!jwk) throw new HttpError(401, "認証鍵が一致しません。", "access_key_missing");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  keyCache.set(`${teamDomain}:${kid}`, { key, expiresAt: Date.now() + 3_600_000 });
  return key;
}

async function verifyAccessToken(token, env) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "ログイン情報が正しくありません。", "invalid_access_token");

  let header;
  let payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    throw new HttpError(401, "ログイン情報を読み取れません。", "invalid_access_token");
  }

  if (header.alg !== "RS256" || !header.kid) {
    throw new HttpError(401, "対応していないログイン形式です。", "invalid_access_algorithm");
  }

  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const audience = String(env.CF_ACCESS_AUD || "").trim();
  if (!teamDomain || !audience) {
    throw new HttpError(503, "Cloudflare Accessの環境変数が未設定です。", "access_setup_required");
  }

  const key = await getVerificationKey(teamDomain, header.kid);
  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = decodeBase64Url(parts[2]);
  const validSignature = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData);
  if (!validSignature) throw new HttpError(401, "ログイン情報を確認できませんでした。", "invalid_access_signature");

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience) || payload.exp <= now || (payload.nbf && payload.nbf > now)) {
    throw new HttpError(401, "ログインの有効期限が切れています。", "expired_access_token");
  }

  const expectedIssuer = `https://${teamDomain}`;
  if (String(payload.iss || "").replace(/\/$/, "") !== expectedIssuer) {
    throw new HttpError(401, "ログイン元を確認できませんでした。", "invalid_access_issuer");
  }

  return payload;
}

export async function requireAdmin(context) {
  const url = new URL(context.request.url);
  if (context.env.ENVIRONMENT === "development" && LOCAL_HOSTS.has(url.hostname)) {
    return { email: "local-preview@tamayui.jp", local: true };
  }

  const token = context.request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    throw new HttpError(401, "管理画面へログインしてください。", "login_required");
  }

  const payload = await verifyAccessToken(token, context.env);
  const email = String(payload.email || context.request.headers.get("Cf-Access-Authenticated-User-Email") || "")
    .trim()
    .toLowerCase();
  const allowedEmails = String(context.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!allowedEmails.length) {
    throw new HttpError(503, "管理者メールアドレスが未設定です。", "admin_email_setup_required");
  }

  if (!email || !allowedEmails.includes(email)) {
    throw new HttpError(403, "このメールアドレスには管理権限がありません。", "admin_denied");
  }

  return { email, local: false };
}
