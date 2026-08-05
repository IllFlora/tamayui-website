import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { requireAdmin } from "../functions/_shared/auth.js";
import { normalizeEventPayload } from "../functions/api/events.js";

const root = new URL("../", import.meta.url);

test("analytics accepts an anonymous page view", () => {
  const payload = normalizeEventPayload({
    eventName: "page_view",
    sessionId: "1234567890abcdef",
    pagePath: "/lessons.html",
    target: "lesson page",
  });
  assert.equal(payload.eventName, "page_view");
  assert.equal(payload.pagePath, "/lessons.html");
});

test("analytics rejects unknown events", () => {
  assert.throws(
    () =>
      normalizeEventPayload({
        eventName: "purchase_complete",
        sessionId: "1234567890abcdef",
        pagePath: "/",
      }),
    /計測イベント/,
  );
});

test("admin API never bypasses authentication outside local development", async () => {
  await assert.rejects(
    () =>
      requireAdmin({
        request: new Request("https://tamayui.jp/api/admin/session"),
        env: { ENVIRONMENT: "production" },
      }),
    (error) => error.code === "login_required" && error.status === 401,
  );
});

test("public pages keep static fallback and load managed galleries", async () => {
  const works = await readFile(new URL("works.html", root), "utf8");
  const lessons = await readFile(new URL("lessons.html", root), "utf8");
  assert.match(works, /data-managed-gallery="works"/);
  assert.match(lessons, /data-managed-gallery="classroom"/);
  assert.match(lessons, /data-managed-gallery="students"/);
  assert.match(works, /photos\/167629\.jpg/);
  assert.match(lessons, /images\/lesson-gallery\/scene-01\.jpg/);
});

test("public pages load anonymous analytics", async () => {
  for (const page of ["index.html", "works.html", "lessons.html"]) {
    const html = await readFile(new URL(page, root), "utf8");
    assert.match(html, /<script src="analytics\.js\?v=1" defer><\/script>/);
  }
});

test("local image and script references in public pages exist", async () => {
  for (const page of ["index.html", "works.html", "lessons.html", "admin/index.html"]) {
    const pageUrl = new URL(page, root);
    const html = await readFile(pageUrl, "utf8");
    const references = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (match) => match[1]);

    for (const reference of references) {
      if (/^(?:https?:|#|mailto:|tel:)/.test(reference)) continue;
      const cleanPath = reference.split(/[?#]/, 1)[0];
      if (!cleanPath || cleanPath.endsWith(".html")) continue;
      await access(new URL(cleanPath, pageUrl));
    }
  }
});

test("admin page is excluded from indexing", async () => {
  const admin = await readFile(new URL("admin/index.html", root), "utf8");
  const robots = await readFile(new URL("robots.txt", root), "utf8");
  assert.match(admin, /noindex, nofollow, noarchive/);
  assert.match(robots, /Disallow: \/admin\//);
  assert.match(robots, /Disallow: \/api\/admin\//);
});

test("important LINE links have stable analytics labels", async () => {
  const index = await readFile(new URL("index.html", root), "utf8");
  assert.match(index, /data-track-id="nav_line"/);
  assert.match(index, /data-track-id="hero_line"/);
  assert.match(index, /data-track-id="lesson_line"/);
  assert.match(index, /data-track-id="order_line"/);
  assert.match(index, /data-track-id="connect_line"/);
  const lessons = await readFile(new URL("lessons.html", root), "utf8");
  assert.match(lessons, /data-track-id="student_invitation_line"/);
  assert.match(lessons, /data-track-id="lessons_closing_line"/);
});
