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

test("every picture element has working webp sources and a jpeg fallback", async () => {
  // srcset のパスを間違えても、ブラウザは <img> のJPEGへ静かに落ちるだけで
  // 見た目には現れない。壊れたWebP参照はここでしか検出できない。
  let pictures = 0;
  let candidates = 0;

  for (const page of ["index.html", "works.html", "lessons.html"]) {
    const html = await readFile(new URL(page, root), "utf8");

    for (const [, block] of html.matchAll(/<picture>([\s\S]*?)<\/picture>/g)) {
      pictures += 1;

      const source = block.match(/<source\b[^>]*>/);
      assert.ok(source, `${page}: <picture> に <source> がない`);
      assert.match(source[0], /type="image\/webp"/, `${page}: <source> の type が image/webp でない`);
      assert.match(source[0], /sizes="/, `${page}: <source> に sizes がない`);

      const srcset = source[0].match(/srcset="([^"]+)"/)?.[1];
      assert.ok(srcset, `${page}: <source> に srcset がない`);
      assert.ok(
        /-\d+\.webp \d+w/.test(srcset),
        `${page}: srcset に縮小版が1つも無く、モバイルでも等倍が配信される`,
      );

      const fallbackWidth = Number(block.match(/<img\b[^>]*width="(\d+)"/)?.[1]);

      for (const entry of srcset.split(",")) {
        const [path, descriptor] = entry.trim().split(/\s+/);
        assert.match(descriptor ?? "", /^\d+w$/, `${page}: ${path} の幅記述子が不正`);
        await access(new URL(path, root));

        // 記述子がファイル名と食い違うと、ブラウザは実在しない解像度を前提に
        // 候補を選ぶため、狙いより粗い/重い画像が配信される。ファイル存在チェック
        // だけでは通ってしまうので、命名規約との対応をここで縛る。
        const declared = Number(descriptor.slice(0, -1));
        const suffix = path.match(/-(\d+|full)\.webp$/)?.[1];
        assert.ok(suffix, `${page}: ${path} が -<幅>.webp / -full.webp の命名でない`);
        if (suffix === "full") {
          assert.equal(declared, fallbackWidth, `${page}: ${path} の記述子が元画像の幅と一致しない`);
        } else {
          assert.equal(declared, Number(suffix), `${page}: ${path} の記述子がファイル名の幅と一致しない`);
        }
        candidates += 1;
      }

      // WebP 非対応環境のフォールバック。width/height はCLS防止に必須。
      const img = block.match(/<img\b[^>]*>/);
      assert.ok(img, `${page}: <picture> に <img> フォールバックがない`);
      assert.match(img[0], /src="[^"]+\.jpe?g"/, `${page}: フォールバックがJPEGでない`);
      assert.match(img[0], /width="\d+"/, `${page}: フォールバックに width がない`);
      assert.match(img[0], /height="\d+"/, `${page}: フォールバックに height がない`);
      assert.match(img[0], /alt="/, `${page}: フォールバックに alt がない`);
    }
  }

  // 固定値で数を縛ると画像を足すたびにテスト修正が要る。数ではなく
  // 「JPEGを指す <img> は例外なく <picture> に入っていること」を動的に検査する。
  for (const page of ["index.html", "works.html", "lessons.html"]) {
    const html = await readFile(new URL(page, root), "utf8");
    const wrapped = new Set();
    for (const [, block] of html.matchAll(/<picture>([\s\S]*?)<\/picture>/g)) {
      const src = block.match(/<img\b[^>]*src="([^"]+)"/)?.[1];
      if (src) wrapped.add(src);
    }
    for (const [tag] of html.matchAll(/<img\b[\s\S]*?>/g)) {
      const src = tag.match(/src="([^"]+)"/)?.[1];
      if (!src || !/\.jpe?g$/i.test(src)) continue;
      assert.ok(wrapped.has(src), `${page}: ${src} が <picture> で包まれておらず WebP が配信されない`);
    }
  }

  assert.ok(pictures > 0, "<picture> が1つも見つからない");
  // 候補数は元画像の幅で決まる (480/800/1200 のうち元幅未満のものだけ + 等倍) ため
  // 固定値では縛れない。「必ず縮小版が1つ以上あること」を各 <picture> で検査済み。
  assert.ok(candidates >= pictures * 2, `srcset 候補が少なすぎる (${candidates} / ${pictures} pictures)`);
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
