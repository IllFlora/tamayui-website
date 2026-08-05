import { requireAdmin } from "../../_shared/auth.js";
import {
  adminMediaItem,
  assertSameOrigin,
  COLLECTIONS,
  errorResponse,
  HttpError,
  json,
  STATUSES,
  text,
} from "../../_shared/http.js";
import { ensureSchema, requireBinding } from "../../_shared/schema.js";

const CONTENT_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

function defaultAlt(collection) {
  if (collection === "classroom") return "たま結のタティングレース教室の様子";
  if (collection === "students") return "生徒が制作したタティングレース作品";
  return "たま結のタティングレース作品";
}

export async function onRequestGet(context) {
  try {
    await requireAdmin(context);
    const db = await ensureSchema(context.env);
    const result = await db
      .prepare(
        `SELECT id, collection, storage_key, filename, content_type, width, height,
                alt_text, status, sort_order, created_at, updated_at
         FROM media_items
         ORDER BY collection ASC, sort_order ASC, created_at ASC`,
      )
      .all();
    return json({ ok: true, items: (result.results || []).map(adminMediaItem) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context) {
  let uploadedKey;
  try {
    assertSameOrigin(context.request);
    await requireAdmin(context);
    const db = await ensureSchema(context.env);
    const bucket = requireBinding(context.env, "MEDIA");
    const form = await context.request.formData();
    const file = form.get("file");
    const collection = text(form.get("collection"), 30);
    const status = text(form.get("status"), 20) || "published";
    const width = Number.parseInt(form.get("width"), 10);
    const height = Number.parseInt(form.get("height"), 10);

    if (!COLLECTIONS.has(collection)) throw new HttpError(400, "展示室を選択してください。", "invalid_collection");
    if (!STATUSES.has(status)) throw new HttpError(400, "公開状態が正しくありません。", "invalid_status");
    if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "写真を選択してください。", "file_required");
    if (!CONTENT_TYPES.has(file.type)) throw new HttpError(415, "JPEG・PNG・WebPのみ追加できます。", "unsupported_image");
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "写真は1枚12MB以下にしてください。", "image_too_large");
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 12_000 || height > 12_000) {
      throw new HttpError(400, "写真サイズを確認できませんでした。", "invalid_dimensions");
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const extension = CONTENT_TYPES.get(file.type);
    uploadedKey = `${collection}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${extension}`;
    const filename = text(file.name, 180) || `${id}.${extension}`;
    const altText = text(form.get("alt"), 240) || defaultAlt(collection);
    const maxOrderRow = await db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM media_items WHERE collection = ?")
      .bind(collection)
      .first();
    const sortOrder = Number(maxOrderRow?.max_order ?? -1) + 1;
    const buffer = await file.arrayBuffer();

    await bucket.put(uploadedKey, buffer, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: { filename },
    });

    await db
      .prepare(
        `INSERT INTO media_items (
          id, collection, storage_key, filename, content_type, width, height,
          alt_text, status, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        collection,
        uploadedKey,
        filename,
        file.type,
        width,
        height,
        altText,
        status,
        sortOrder,
        now.toISOString(),
        now.toISOString(),
      )
      .run();

    const row = await db.prepare("SELECT * FROM media_items WHERE id = ?").bind(id).first();
    return json({ ok: true, item: adminMediaItem(row) }, 201);
  } catch (error) {
    if (uploadedKey && context.env.MEDIA) {
      await context.env.MEDIA.delete(uploadedKey).catch(() => {});
    }
    return errorResponse(error);
  }
}
