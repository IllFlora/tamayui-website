import { requireAdmin } from "../../_shared/auth.js";
import { assertSameOrigin, COLLECTIONS, errorResponse, HttpError, json, readJson, text } from "../../_shared/http.js";
import { ensureSchema } from "../../_shared/schema.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    await requireAdmin(context);
    const db = await ensureSchema(context.env);
    const body = await readJson(context.request, 64_000);
    const collection = text(body.collection, 30);
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => text(id, 80)).filter(Boolean) : [];

    if (!COLLECTIONS.has(collection)) throw new HttpError(400, "展示室が正しくありません。", "invalid_collection");
    if (!ids.length || ids.length > 500 || new Set(ids).size !== ids.length) {
      throw new HttpError(400, "並び順の情報が正しくありません。", "invalid_order");
    }

    const existing = await db
      .prepare("SELECT id FROM media_items WHERE collection = ? ORDER BY sort_order ASC")
      .bind(collection)
      .all();
    const existingIds = new Set((existing.results || []).map((row) => row.id));
    if (ids.some((id) => !existingIds.has(id)) || ids.length !== existingIds.size) {
      throw new HttpError(409, "一覧が更新されています。再読み込みしてください。", "stale_order");
    }

    await db.batch(
      ids.map((id, index) =>
        db
          .prepare("UPDATE media_items SET sort_order = ?, updated_at = ? WHERE id = ? AND collection = ?")
          .bind(index, new Date().toISOString(), id, collection),
      ),
    );

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
