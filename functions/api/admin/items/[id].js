import { requireAdmin } from "../../../_shared/auth.js";
import {
  adminMediaItem,
  assertSameOrigin,
  COLLECTIONS,
  errorResponse,
  HttpError,
  json,
  noContent,
  readJson,
  STATUSES,
  text,
} from "../../../_shared/http.js";
import { ensureSchema, requireBinding } from "../../../_shared/schema.js";

export async function onRequestPatch(context) {
  try {
    assertSameOrigin(context.request);
    await requireAdmin(context);
    const db = await ensureSchema(context.env);
    const id = text(context.params.id, 80);
    const current = await db.prepare("SELECT * FROM media_items WHERE id = ?").bind(id).first();
    if (!current) throw new HttpError(404, "写真が見つかりません。", "item_not_found");

    const body = await readJson(context.request);
    const collection = body.collection === undefined ? current.collection : text(body.collection, 30);
    const status = body.status === undefined ? current.status : text(body.status, 20);
    const altText = body.alt === undefined ? current.alt_text : text(body.alt, 240);
    if (!COLLECTIONS.has(collection)) throw new HttpError(400, "展示室が正しくありません。", "invalid_collection");
    if (!STATUSES.has(status)) throw new HttpError(400, "公開状態が正しくありません。", "invalid_status");

    let sortOrder = Number(current.sort_order);
    if (collection !== current.collection) {
      const row = await db
        .prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM media_items WHERE collection = ?")
        .bind(collection)
        .first();
      sortOrder = Number(row?.max_order ?? -1) + 1;
    }

    await db
      .prepare(
        `UPDATE media_items
         SET collection = ?, alt_text = ?, status = ?, sort_order = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(collection, altText, status, sortOrder, new Date().toISOString(), id)
      .run();

    const updated = await db.prepare("SELECT * FROM media_items WHERE id = ?").bind(id).first();
    return json({ ok: true, item: adminMediaItem(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function onRequestDelete(context) {
  try {
    assertSameOrigin(context.request);
    await requireAdmin(context);
    const db = await ensureSchema(context.env);
    const bucket = requireBinding(context.env, "MEDIA");
    const id = text(context.params.id, 80);
    const current = await db.prepare("SELECT storage_key FROM media_items WHERE id = ?").bind(id).first();
    if (!current) throw new HttpError(404, "写真が見つかりません。", "item_not_found");

    await bucket.delete(current.storage_key);
    await db.prepare("DELETE FROM media_items WHERE id = ?").bind(id).run();
    return noContent();
  } catch (error) {
    return errorResponse(error);
  }
}
