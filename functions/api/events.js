import { assertSameOrigin, errorResponse, HttpError, noContent, readJson, text } from "../_shared/http.js";
import { ensureSchema } from "../_shared/schema.js";

const EVENT_NAMES = new Set([
  "page_view",
  "line_click",
  "instagram_click",
  "note_click",
  "gallery_click",
]);

export function normalizeEventPayload(body) {
  const eventName = text(body.eventName, 40);
  const sessionId = text(body.sessionId, 80);
  const pagePath = text(body.pagePath, 240);

  if (!EVENT_NAMES.has(eventName)) {
    throw new HttpError(400, "計測イベントが正しくありません。", "invalid_event");
  }
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(sessionId)) {
    throw new HttpError(400, "セッション情報が正しくありません。", "invalid_session");
  }
  if (!pagePath.startsWith("/")) {
    throw new HttpError(400, "ページ情報が正しくありません。", "invalid_path");
  }

  return {
    eventName,
    sessionId,
    pagePath,
    target: text(body.target, 120),
    experimentKey: text(body.experimentKey, 80),
    variant: text(body.variant, 80),
    utmSource: text(body.utmSource, 100),
    utmMedium: text(body.utmMedium, 100),
    utmCampaign: text(body.utmCampaign, 100),
  };
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const payload = normalizeEventPayload(await readJson(context.request, 8_192));
    const db = await ensureSchema(context.env);

    await db
      .prepare(
        `INSERT INTO analytics_events (
          id, session_id, event_name, page_path, target,
          experiment_key, variant, utm_source, utm_medium, utm_campaign, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        payload.sessionId,
        payload.eventName,
        payload.pagePath,
        payload.target,
        payload.experimentKey,
        payload.variant,
        payload.utmSource,
        payload.utmMedium,
        payload.utmCampaign,
        new Date().toISOString(),
      )
      .run();

    return noContent();
  } catch (error) {
    return errorResponse(error);
  }
}
