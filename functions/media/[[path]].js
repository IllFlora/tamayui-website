import { errorResponse, HttpError } from "../_shared/http.js";
import { requireBinding } from "../_shared/schema.js";

export async function onRequestGet(context) {
  try {
    const rawPath = Array.isArray(context.params.path)
      ? context.params.path.join("/")
      : String(context.params.path || "");
    const key = rawPath
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");

    if (!key || key.includes("..") || key.startsWith("/")) {
      throw new HttpError(400, "画像パスが正しくありません。", "invalid_media_path");
    }

    const bucket = requireBinding(context.env, "MEDIA");
    const object = await bucket.get(key);
    if (!object) throw new HttpError(404, "画像が見つかりません。", "media_not_found");

    if (context.request.headers.get("if-none-match") === object.httpEtag) {
      return new Response(null, { status: 304, headers: { etag: object.httpEtag } });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
