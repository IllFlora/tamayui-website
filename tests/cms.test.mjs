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
      // Cloudflare Pages の clean URL 対応で、内部リンクは "/", "/works", "/lessons" の
      // 拡張子なし形式になっている。実体は <name>.html なので読み替えて存在確認する。
      const cleanUrlTarget = cleanPath.match(/^\/([\w-]+)$/);
      if (cleanUrlTarget) {
        await access(new URL(`${cleanUrlTarget[1]}.html`, root));
        continue;
      }
      if (cleanPath === "/") continue;
      // ルート絶対パスはリポジトリ直下から、相対パスはそのページからの相対で解決する。
      await access(cleanPath.startsWith("/") ? new URL(cleanPath.slice(1), root) : new URL(cleanPath, pageUrl));
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

test("public pages never hide content when JavaScript fails", async () => {
  // .reveal / .reveal-media / .reveal-copy は opacity:0 で始まるため、
  // 「motion-ready を JS が付けるまで隠さない」ゲートと、
  // 「JS が動かなければ 800ms で諦めて表示する」タイマーの両方が必要になる。
  // 片方でも欠けると、その ページは JS 無効・JS エラー時に本文が消える。
  for (const page of ["index.html", "works.html", "lessons.html"]) {
    const html = await readFile(new URL(page, root), "utf8");
    assert.match(html, /classList\.add\("motion-ready"\)/, `${page} に motion-ready の付与がない`);
    assert.match(html, /__motionFallbackTimer/, `${page} に motion-fallback タイマーがない`);
  }

  for (const sheet of ["styles.css", "works.css", "lessons.css"]) {
    const css = await readFile(new URL(sheet, root), "utf8");

    // 正規表現1本での検査は、行頭アンカーが `  .reveal {`(@media内のインデント)や
    // `html .reveal {` を取り逃す。規則を列挙して、セレクタと宣言を別々に判定する。
    const offenders = [];
    for (const [, rawSelector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rawSelector.trim();
      if (!/\.reveal[-\w]*\b/.test(selector)) continue;
      if (!/(?:^|[;{\s])opacity:\s*0(?:\D|$)/.test(body)) continue;
      // .motion-ready 配下、または @media (prefers-reduced-motion) 内の打ち消しは正当。
      if (/\.motion-ready\b/.test(selector)) continue;
      offenders.push(selector.replace(/\s+/g, " "));
    }
    assert.deepEqual(
      offenders,
      [],
      `${sheet} に motion-ready でゲートされていない .reveal 系の opacity:0 がある: ${offenders.join(" / ")}`,
    );

    assert.match(css, /\.motion-fallback \./, `${sheet} に motion-fallback の復帰指定がない`);
  }
});

test("public pages expose Open Graph metadata for sharing", async () => {
  for (const page of ["index.html", "works.html", "lessons.html"]) {
    const html = await readFile(new URL(page, root), "utf8");
    for (const property of ["og:type", "og:url", "og:title", "og:description", "og:image"]) {
      assert.match(html, new RegExp(`property="${property}"`), `${page} に ${property} がない`);
    }
    assert.match(html, /name="twitter:card"/, `${page} に twitter:card がない`);

    // og:image は絶対URLでなければ各SNSが解決できない。
    const image = html.match(/property="og:image" content="([^"]+)"/)?.[1];
    assert.ok(image?.startsWith("https://tamayui.jp/"), `${page} の og:image が絶対URLでない`);
    // 実ファイルが存在すること。
    await access(new URL(image.replace("https://tamayui.jp/", ""), root));
  }
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
