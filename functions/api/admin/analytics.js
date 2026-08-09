import { requireAdmin } from "../../_shared/auth.js";
import { errorResponse, integer, json } from "../../_shared/http.js";
import { ensureSchema } from "../../_shared/schema.js";

// 運用者も閲覧者も日本にいる。UTCで日付を切ると、日本時間の 0:00〜8:59 のアクセスが
// 前日に集計されてしまい、管理画面の「日ごとの反応」が実感と9時間ずれる。
// そのため集計・境界とも JST(UTC+9) で統一する。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// occurred_at は toISOString() 由来の "YYYY-MM-DDTHH:MM:SS.sssZ"。
// SQLite の datetime() に末尾 Z 付きを渡すのは版依存で不安定なため、
// 秒までを切り出してから +9時間する。
const JST_DAY = "substr(datetime(substr(occurred_at, 1, 19), '+9 hours'), 1, 10)";

/** JST基準で days 日前の 0:00 を、UTCのISO文字列で返す */
function jstRangeStart(days) {
  const nowInJst = new Date(Date.now() + JST_OFFSET_MS);
  const midnightJstAsUtc = Date.UTC(
    nowInJst.getUTCFullYear(),
    nowInJst.getUTCMonth(),
    nowInJst.getUTCDate(),
  ) - JST_OFFSET_MS;
  return new Date(midnightJstAsUtc - (days - 1) * 86_400_000).toISOString();
}

/** 期間内の全日付(JST)を古い順に返す。イベントが無い日も含む。 */
function jstDaysInRange(days) {
  const nowInJst = new Date(Date.now() + JST_OFFSET_MS);
  const todayUtcMidnight = Date.UTC(
    nowInJst.getUTCFullYear(),
    nowInJst.getUTCMonth(),
    nowInJst.getUTCDate(),
  );
  const list = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    list.push(new Date(todayUtcMidnight - i * 86_400_000).toISOString().slice(0, 10));
  }
  return list;
}

export async function onRequestGet(context) {
  try {
    await requireAdmin(context);
    const db = await ensureSchema(context.env);
    const url = new URL(context.request.url);
    const days = integer(url.searchParams.get("days"), 7, 90, 30);
    const sinceIso = jstRangeStart(days);

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
          `SELECT ${JST_DAY} AS day,
                  SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END) AS page_views,
                  COUNT(DISTINCT CASE WHEN event_name = 'page_view' THEN session_id END) AS sessions,
                  COUNT(DISTINCT CASE WHEN event_name = 'line_click' THEN session_id END) AS line_sessions
           FROM analytics_events
           WHERE occurred_at >= ?
           GROUP BY day
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

    // GROUP BY はイベントが有る日しか返さない。そのまま描画すると、直近数日にしか
    // データが無い場合に 7日/30日/90日 のどれを選んでも同じ本数の棒が出てしまい、
    // 「期間を変えても何も変わらない」という症状になる。ここで全日を0埋めする。
    const byDay = new Map((daily.results || []).map((row) => [row.day, row]));
    const series = jstDaysInRange(days).map((day) => {
      const row = byDay.get(day);
      return {
        day,
        pageViews: Number(row?.page_views || 0),
        sessions: Number(row?.sessions || 0),
        lineSessions: Number(row?.line_sessions || 0),
      };
    });

    const sessions = Number(summary?.sessions || 0);
    const lineSessions = Number(summary?.line_sessions || 0);
    return json({
      ok: true,
      range: {
        days,
        since: sinceIso,
        from: series[0]?.day ?? null,
        to: series[series.length - 1]?.day ?? null,
        timezone: "Asia/Tokyo",
      },
      summary: {
        pageViews: Number(summary?.page_views || 0),
        sessions,
        lineClicks: Number(summary?.line_clicks || 0),
        lineSessions,
        lineTransitionRate: sessions ? Math.round((lineSessions / sessions) * 10_000) / 100 : 0,
      },
      daily: series,
      targets: targets.results || [],
      pages: pages.results || [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
