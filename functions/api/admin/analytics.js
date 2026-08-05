import { requireAdmin } from "../../_shared/auth.js";
import { errorResponse, integer, json } from "../../_shared/http.js";
import { ensureSchema } from "../../_shared/schema.js";

export async function onRequestGet(context) {
  try {
    await requireAdmin(context);
    const db = await ensureSchema(context.env);
    const url = new URL(context.request.url);
    const days = integer(url.searchParams.get("days"), 7, 90, 30);
    const since = new Date(Date.now() - (days - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();

    const [summary, daily, targets, pages] = await Promise.all([
      db
        .prepare(
          `SELECT
             SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END) AS page_views,
             COUNT(DISTINCT CASE WHEN event_name = 'page_view' THEN session_id END) AS sessions,
             SUM(CASE WHEN event_name = 'line_click' THEN 1 ELSE 0 END) AS line_clicks,
             COUNT(DISTINCT CASE WHEN event_name = 'line_click' THEN session_id END) AS line_sessions
           FROM analytics_events WHERE occurred_at >= ?`,
        )
        .bind(sinceIso)
        .first(),
      db
        .prepare(
          `SELECT substr(occurred_at, 1, 10) AS day,
                  SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END) AS page_views,
                  COUNT(DISTINCT CASE WHEN event_name = 'page_view' THEN session_id END) AS sessions,
                  COUNT(DISTINCT CASE WHEN event_name = 'line_click' THEN session_id END) AS line_sessions
           FROM analytics_events
           WHERE occurred_at >= ?
           GROUP BY substr(occurred_at, 1, 10)
           ORDER BY day ASC`,
        )
        .bind(sinceIso)
        .all(),
      db
        .prepare(
          `SELECT event_name, target, experiment_key, variant,
                  COUNT(*) AS clicks, COUNT(DISTINCT session_id) AS sessions
           FROM analytics_events
           WHERE occurred_at >= ? AND event_name != 'page_view'
           GROUP BY event_name, target, experiment_key, variant
           ORDER BY clicks DESC
           LIMIT 30`,
        )
        .bind(sinceIso)
        .all(),
      db
        .prepare(
          `SELECT page_path, COUNT(*) AS views, COUNT(DISTINCT session_id) AS sessions
           FROM analytics_events
           WHERE occurred_at >= ? AND event_name = 'page_view'
           GROUP BY page_path
           ORDER BY views DESC
           LIMIT 20`,
        )
        .bind(sinceIso)
        .all(),
    ]);

    const sessions = Number(summary?.sessions || 0);
    const lineSessions = Number(summary?.line_sessions || 0);
    return json({
      ok: true,
      range: { days, since: sinceIso },
      summary: {
        pageViews: Number(summary?.page_views || 0),
        sessions,
        lineClicks: Number(summary?.line_clicks || 0),
        lineSessions,
        lineTransitionRate: sessions ? Math.round((lineSessions / sessions) * 10_000) / 100 : 0,
      },
      daily: daily.results || [],
      targets: targets.results || [],
      pages: pages.results || [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
