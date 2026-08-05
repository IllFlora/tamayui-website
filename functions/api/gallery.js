import { COLLECTIONS, errorResponse, json, publicMediaItem } from "../_shared/http.js";
import { ensureSchema } from "../_shared/schema.js";

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const collection = url.searchParams.get("collection");
    if (!COLLECTIONS.has(collection)) {
      return json({ ok: false, error: "invalid_collection" }, 400);
    }

    const db = await ensureSchema(context.env);
    const result = await db
      .prepare(
        `SELECT id, collection, storage_key, width, height, alt_text, status, sort_order, created_at
         FROM media_items
         WHERE collection = ? AND status = 'published'
         ORDER BY sort_order ASC, created_at ASC`,
      )
      .bind(collection)
      .all();

    return json(
      { ok: true, items: (result.results || []).map(publicMediaItem) },
      200,
      { "cache-control": "public, max-age=20, stale-while-revalidate=40" },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
