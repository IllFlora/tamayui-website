import { SetupRequiredError } from "./schema.js";

export const COLLECTIONS = new Set(["works", "classroom", "students"]);
export const STATUSES = new Set(["published", "draft"]);

export class HttpError extends Error {
  constructor(status, message, code = "request_error") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export function noContent() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export function errorResponse(error) {
  if (error instanceof HttpError) {
    return json({ ok: false, error: error.code, message: error.message }, error.status);
  }

  if (error instanceof SetupRequiredError) {
    return json(
      {
        ok: false,
        error: "setup_required",
        message: "Cloudflareの保存先がまだ接続されていません。管理者向けセットアップを完了してください。",
      },
      503,
    );
  }

  console.error(error);
  return json({ ok: false, error: "internal_error", message: "処理中にエラーが発生しました。" }, 500);
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const url = new URL(request.url);
  if (origin !== url.origin) {
    throw new HttpError(403, "別サイトからの操作は受け付けていません。", "origin_denied");
  }
}

export async function readJson(request, maxBytes = 16_384) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    throw new HttpError(413, "送信データが大きすぎます。", "payload_too_large");
  }

  let parsed;
  try {
    parsed = await request.json();
  } catch {
    throw new HttpError(400, "JSON形式が正しくありません。", "invalid_json");
  }

  // JSON.parse("null") は null を返すため、呼び出し側の body.foo が TypeError になり
  // 400 ではなく 500 になっていた。オブジェクトであることをここで保証する。
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "送信内容の形式が正しくありません。", "invalid_body");
  }
  return parsed;
}

export function text(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function integer(value, min, max, fallback = min) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function publicMediaItem(row) {
  return {
    id: row.id,
    collection: row.collection,
    url: `/media/${row.storage_key.split("/").map(encodeURIComponent).join("/")}`,
    width: Number(row.width),
    height: Number(row.height),
    alt: row.alt_text,
    status: row.status,
    order: Number(row.sort_order),
    createdAt: row.created_at,
  };
}

export function adminMediaItem(row) {
  return {
    ...publicMediaItem(row),
    filename: row.filename,
    contentType: row.content_type,
    updatedAt: row.updated_at,
  };
}
