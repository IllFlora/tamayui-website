(() => {
  const collections = {
    works: "作家作品",
    classroom: "教室の様子",
    students: "生徒作品",
  };
  const eventLabels = {
    line_click: "公式LINE",
    instagram_click: "Instagram",
    note_click: "note",
    gallery_click: "ギャラリー",
  };
  const state = {
    items: [],
    queue: [],
    filter: "works",
    analyticsDays: 30,
    busy: false,
  };

  const dom = {
    connection: document.querySelector("#connection-status"),
    tabs: document.querySelector(".admin-tabs"),
    panels: document.querySelectorAll("[data-panel]"),
    photoInput: document.querySelector("#photo-input"),
    dropZone: document.querySelector("#drop-zone"),
    queue: document.querySelector("#upload-queue"),
    queueCount: document.querySelector("#queue-count"),
    uploadButton: document.querySelector("#upload-button"),
    publishNow: document.querySelector("#publish-now"),
    library: document.querySelector("#media-library"),
    filters: document.querySelector(".library-filters"),
    refreshItems: document.querySelector("#refresh-items"),
    analyticsRange: document.querySelector("#analytics-range"),
    rangeSummary: document.querySelector("#range-summary"),
    analyticsPanel: document.querySelector("#analytics-panel"),
    dailyChart: document.querySelector("#daily-chart"),
    targetList: document.querySelector("#target-list"),
    pageList: document.querySelector("#page-list"),
    toast: document.querySelector("#toast"),
  };

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: { accept: "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (response.status === 204) return null;

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || "通信に失敗しました。");
      error.code = body.error || "request_error";
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function setConnection(message, mode = "loading") {
    dom.connection.classList.toggle("is-ready", mode === "ready");
    dom.connection.classList.toggle("is-error", mode === "error");
    dom.connection.querySelector("p").textContent = message;
  }

  let toastTimer;
  function toast(message, mode = "success") {
    clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.toggle("is-error", mode === "error");
    dom.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => dom.toast.classList.remove("is-visible"), 3200);
  }

  function currentUploadCollection() {
    return document.querySelector('input[name="upload-collection"]:checked')?.value || "works";
  }

  function defaultAlt(collection) {
    if (collection === "classroom") return "たま結のタティングレース教室の様子";
    if (collection === "students") return "生徒が制作したタティングレース作品";
    return "たま結のタティングレース作品";
  }

  async function decodeImage(file) {
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        return createImageBitmap(file);
      }
    }

    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function prepareImage(file, collection) {
    if (!file.type.startsWith("image/")) throw new Error(`${file.name} は画像ではありません。`);
    if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} は30MBを超えています。`);

    const source = await decodeImage(file);
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    const maxEdge = 2600;
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    context.drawImage(source, 0, 0, width, height);
    if (typeof source.close === "function") source.close();

    // toBlob は未対応の type を渡されると null ではなく image/png で返す仕様。
    // そのまま .webp / image/webp として送ると、実体PNGなのにDBのcontent_typeが
    // image/webp になり、拡張子と中身が食い違う。返ってきた type で判定する。
    const encoded = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!encoded) throw new Error(`${file.name} を軽量化できませんでした。`);
    const isWebp = encoded.type === "image/webp";
    const outputType = isWebp ? "image/webp" : "image/png";
    const outputExt = isWebp ? "webp" : "png";
    const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "tamayui-photo";
    const optimized = new File([encoded], `${baseName}.${outputExt}`, { type: outputType });
    return {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      file: optimized,
      originalName: file.name,
      preview: URL.createObjectURL(encoded),
      collection,
      alt: defaultAlt(collection),
      width,
      height,
      originalBytes: file.size,
      optimizedBytes: optimized.size,
    };
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 30 - state.queue.length);
    if (!files.length) return;
    setConnection(`${files.length}枚の写真を準備しています`);
    const collection = currentUploadCollection();

    for (const file of files) {
      try {
        const prepared = await prepareImage(file, collection);
        state.queue.push(prepared);
      } catch (error) {
        toast(error.message, "error");
      }
    }

    renderQueue();
    setConnection("公開準備ができました", "ready");
    dom.photoInput.value = "";
  }

  function readableSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  function renderQueue() {
    dom.queue.replaceChildren();
    state.queue.forEach((item) => {
      const card = node("article", "queue-item");
      card.dataset.id = item.id;
      const image = document.createElement("img");
      image.src = item.preview;
      image.alt = "追加前の写真プレビュー";

      const label = node("label", "", `${collections[item.collection]} · ${readableSize(item.optimizedBytes)}`);
      const input = document.createElement("input");
      input.value = item.alt;
      input.maxLength = 240;
      input.dataset.queueAlt = item.id;
      input.setAttribute("aria-label", `${item.originalName}の代替テキスト`);
      label.append(input);

      const remove = node("button", "remove-queue", "×");
      remove.type = "button";
      remove.dataset.removeQueue = item.id;
      remove.setAttribute("aria-label", `${item.originalName}を取り消す`);
      card.append(image, label, remove);
      dom.queue.append(card);
    });

    dom.queueCount.textContent = `${state.queue.length}枚`;
    dom.uploadButton.disabled = !state.queue.length || state.busy;
  }

  async function uploadQueue() {
    if (!state.queue.length || state.busy) return;
    state.busy = true;
    renderQueue();
    const total = state.queue.length;
    let completed = 0;

    try {
      for (const item of [...state.queue]) {
        setConnection(`${completed + 1}/${total}枚目を追加しています`);
        const form = new FormData();
        form.append("file", item.file);
        form.append("collection", item.collection);
        form.append("status", dom.publishNow.checked ? "published" : "draft");
        form.append("width", String(item.width));
        form.append("height", String(item.height));
        form.append("alt", item.alt);
        await api("/api/admin/items", { method: "POST", body: form });
        URL.revokeObjectURL(item.preview);
        completed += 1;
        state.queue = state.queue.filter((candidate) => candidate.id !== item.id);
        renderQueue();
      }

      await loadItems();
      setConnection(`${completed}枚を${dom.publishNow.checked ? "公開" : "下書き保存"}しました`, "ready");
      toast("写真を追加しました。");
    } catch (error) {
      setConnection(error.message, "error");
      toast(error.message, "error");
    } finally {
      state.busy = false;
      renderQueue();
    }
  }

  async function loadItems() {
    const body = await api("/api/admin/items");
    state.items = body.items || [];
    renderLibrary();
  }

  function collectionSelect(item) {
    const select = document.createElement("select");
    select.dataset.action = "collection";
    select.setAttribute("aria-label", "展示室を変更");
    Object.entries(collections).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = item.collection === value;
      select.append(option);
    });
    return select;
  }

  function renderLibrary() {
    dom.library.replaceChildren();
    const items = state.items
      .filter((item) => item.collection === state.filter)
      .sort((a, b) => a.order - b.order);
    if (!items.length) {
      dom.library.append(node("p", "empty-state", "この展示室には、管理画面から追加した写真がまだありません。"));
      return;
    }

    items.forEach((item, index) => {
      const card = node("article", "media-card");
      card.dataset.id = item.id;
      const image = document.createElement("img");
      image.src = item.url;
      image.alt = item.alt || "管理中の写真";
      image.loading = "lazy";

      const body = node("div", "media-card-body");
      const meta = node("div", "media-card-meta");
      meta.append(collectionSelect(item));
      const badge = node("span", `status-badge${item.status === "draft" ? " is-draft" : ""}`, item.status === "draft" ? "下書き" : "公開中");
      meta.append(badge);

      const alt = document.createElement("input");
      alt.value = item.alt;
      alt.maxLength = 240;
      alt.dataset.action = "alt";
      alt.setAttribute("aria-label", "写真の説明");

      const actions = node("div", "media-card-actions");
      const up = node("button", "", "↑");
      up.type = "button";
      up.dataset.action = "up";
      up.disabled = index === 0;
      up.setAttribute("aria-label", "ひとつ前へ");
      const down = node("button", "", "↓");
      down.type = "button";
      down.dataset.action = "down";
      down.disabled = index === items.length - 1;
      down.setAttribute("aria-label", "ひとつ後ろへ");
      const visibility = node("button", "", item.status === "published" ? "隠す" : "公開");
      visibility.type = "button";
      visibility.dataset.action = "visibility";
      const remove = node("button", "", "削除");
      remove.type = "button";
      remove.dataset.action = "delete";
      actions.append(up, down, visibility, remove);

      body.append(meta, alt, actions);
      card.append(image, body);
      dom.library.append(card);
    });
  }

  async function updateItem(id, changes, successMessage) {
    const body = await api(`/api/admin/items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changes),
    });
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items[index] = body.item;
    renderLibrary();
    if (successMessage) toast(successMessage);
  }

  async function reorderItem(id, direction) {
    const items = state.items.filter((item) => item.collection === state.filter).sort((a, b) => a.order - b.order);
    const index = items.findIndex((item) => item.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return;
    [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
    items.forEach((item, order) => {
      item.order = order;
    });
    renderLibrary();
    await api("/api/admin/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collection: state.filter, ids: items.map((item) => item.id) }),
    });
    toast("並び順を変更しました。");
  }

  async function handleLibraryChange(event) {
    const card = event.target.closest("[data-id]");
    if (!card) return;
    const id = card.dataset.id;
    try {
      if (event.target.dataset.action === "alt") {
        await updateItem(id, { alt: event.target.value }, "写真の説明を保存しました。");
      }
      if (event.target.dataset.action === "collection") {
        await updateItem(id, { collection: event.target.value }, "展示室を移動しました。");
      }
    } catch (error) {
      toast(error.message, "error");
      await loadItems().catch(() => {});
    }
  }

  async function handleLibraryClick(event) {
    const button = event.target.closest("button[data-action]");
    const card = button?.closest("[data-id]");
    if (!button || !card) return;
    const id = card.dataset.id;
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;

    try {
      if (button.dataset.action === "up") await reorderItem(id, -1);
      if (button.dataset.action === "down") await reorderItem(id, 1);
      if (button.dataset.action === "visibility") {
        const nextStatus = item.status === "published" ? "draft" : "published";
        await updateItem(id, { status: nextStatus }, nextStatus === "published" ? "写真を公開しました。" : "写真を非公開にしました。");
      }
      if (button.dataset.action === "delete") {
        if (!window.confirm("この写真を完全に削除しますか？")) return;
        await api(`/api/admin/items/${encodeURIComponent(id)}`, { method: "DELETE" });
        state.items = state.items.filter((candidate) => candidate.id !== id);
        renderLibrary();
        toast("写真を削除しました。");
      }
    } catch (error) {
      toast(error.message, "error");
      await loadItems().catch(() => {});
    }
  }

  function renderMetric(id, value) {
    const target = document.querySelector(id);
    if (target) target.textContent = value;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svg(tag, attrs = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    return element;
  }

  function formatDay(day) {
    return day.slice(5).replace("-", "/");
  }

  /**
   * 日ごとの棒グラフ。90日を選ぶと棒が90本並ぶため、DOM要素を日数分作るのではなく
   * viewBox 固定の SVG に描いて幅に追従させる。ラベルは重ならない本数だけ間引く。
   */
  function renderDailyChart(series) {
    dom.dailyChart.replaceChildren();

    if (!series.length) {
      dom.dailyChart.append(node("p", "empty-state", "計測データがまだありません。公開後のアクセスから蓄積されます。"));
      return;
    }

    const total = series.reduce((sum, row) => sum + row.pageViews + row.lineSessions, 0);
    if (total === 0) {
      dom.dailyChart.append(
        node("p", "empty-state", "この期間のアクセスはまだ記録されていません。期間を広げるか、公開後しばらくお待ちください。"),
      );
      return;
    }

    // viewBox を固定幅にすると、360px の端末では 360/960 = 0.375 倍に縮み、
    // 11px 指定の軸ラベルが実測4px程度になって読めない。
    // 実際のコンテナ幅を viewBox 幅にして 1:1 で描き、文字サイズを実寸どおりにする。
    const W = Math.max(320, Math.round(dom.dailyChart.clientWidth || 960));
    const H = W < 520 ? 220 : 260;
    const padL = 34;
    const padR = 8;
    const padT = 14;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // LINE遷移だけが記録された日(page_view の送信が失敗した等)に棒が枠外へ出ないよう、
    // 上限は両系列の最大から取る。
    const peak = Math.max(1, ...series.map((row) => Math.max(row.pageViews, row.lineSessions)));
    // 目盛りはキリのよい数に丸める（1,2,5,10,20,50…）
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((n) => peak / n <= 4) || 10000;
    const top = Math.ceil(peak / step) * step;

    const chart = svg("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "daily-chart-svg",
      role: "img",
      "aria-label": `日ごとの閲覧数とLINE遷移数。${formatDay(series[0].day)}から${formatDay(series[series.length - 1].day)}まで。`,
    });

    // 横罫線と目盛り
    for (let v = 0; v <= top; v += step) {
      const y = padT + plotH - (v / top) * plotH;
      chart.append(svg("line", { x1: padL, y1: y, x2: W - padR, y2: y, class: "grid-line" }));
      const label = svg("text", { x: padL - 8, y: y + 4, class: "axis-label", "text-anchor": "end" });
      label.textContent = String(v);
      chart.append(label);
    }

    const slot = plotW / series.length;
    const barW = Math.max(1, Math.min(18, slot * 0.62));
    // 日付ラベルは 1つ約38px 必要。入る本数だけに間引く。
    const labelSlots = Math.max(2, Math.floor(plotW / 38));
    const labelEvery = Math.ceil(series.length / labelSlots);

    series.forEach((row, index) => {
      const cx = padL + slot * (index + 0.5);
      const viewsH = (row.pageViews / top) * plotH;
      const lineH = (row.lineSessions / top) * plotH;

      const group = svg("g", { class: "chart-day" });
      const title = svg("title");
      title.textContent = `${row.day}　閲覧 ${row.pageViews} / LINE ${row.lineSessions}`;
      group.append(title);

      // 値が0の日も「棒がない日」として見えるよう、ホバー領域は必ず置く
      group.append(svg("rect", { x: cx - slot / 2, y: padT, width: slot, height: plotH, class: "chart-hit" }));

      if (row.pageViews > 0) {
        group.append(
          svg("rect", {
            x: cx - barW / 2,
            y: padT + plotH - viewsH,
            width: barW,
            height: Math.max(1.5, viewsH),
            rx: Math.min(2, barW / 2),
            class: "bar-views",
          }),
        );
      }
      if (row.lineSessions > 0) {
        group.append(
          svg("rect", {
            x: cx - barW / 2,
            y: padT + plotH - lineH,
            width: barW,
            height: Math.max(1.5, lineH),
            rx: Math.min(2, barW / 2),
            class: "bar-line",
          }),
        );
      }

      if (index % labelEvery === 0 || index === series.length - 1) {
        const text = svg("text", { x: cx, y: H - 10, class: "axis-label", "text-anchor": "middle" });
        text.textContent = formatDay(row.day);
        group.append(text);
      }

      chart.append(group);
    });

    // 軸線
    chart.append(svg("line", { x1: padL, y1: padT + plotH, x2: W - padR, y2: padT + plotH, class: "axis-line" }));

    dom.dailyChart.append(chart);
  }

  // viewBox をコンテナ幅に合わせている以上、幅が変わったら描き直す必要がある。
  let lastSeries = [];
  let resizeTimer;
  function watchChartResize() {
    window.addEventListener(
      "resize",
      () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (lastSeries.length) renderDailyChart(lastSeries);
        }, 150);
      },
      { passive: true },
    );
  }

  function renderAnalytics(data) {
    const summary = data.summary || {};
    renderMetric("#metric-sessions", Number(summary.sessions || 0).toLocaleString("ja-JP"));
    renderMetric("#metric-pageviews", Number(summary.pageViews || 0).toLocaleString("ja-JP"));
    renderMetric("#metric-line-clicks", Number(summary.lineClicks || 0).toLocaleString("ja-JP"));
    renderMetric("#metric-line-sessions", `${Number(summary.lineSessions || 0).toLocaleString("ja-JP")}セッション`);
    renderMetric("#metric-cv", `${Number(summary.lineTransitionRate || 0).toFixed(1)}%`);

    // 選んだ期間が画面に出ていないと、数字が同じときに切り替わったのか判断できない。
    const range = data.range || {};
    if (dom.rangeSummary) {
      dom.rangeSummary.textContent =
        range.from && range.to
          ? `${range.from.replace(/-/g, "/")} 〜 ${range.to.replace(/-/g, "/")}（日本時間 ${range.days}日間）`
          : "";
    }

    lastSeries = data.daily || [];
    renderDailyChart(lastSeries);

    dom.targetList.replaceChildren();
    const targets = data.targets || [];
    if (!targets.length) {
      dom.targetList.append(node("p", "empty-state", "CTAのクリックはまだありません。"));
    } else {
      targets.forEach((row) => {
        const label = `${eventLabels[row.event_name] || row.event_name} · ${row.target || "名称なし"}`;
        const entry = node("div", "ranking-row");
        entry.append(node("span", "", label), node("strong", "", String(row.clicks || 0)));
        dom.targetList.append(entry);
      });
    }

    dom.pageList.replaceChildren();
    const pages = data.pages || [];
    if (!pages.length) {
      dom.pageList.append(node("p", "empty-state", "ページ閲覧データはまだありません。"));
    } else {
      pages.forEach((row) => {
        const entry = node("div", "ranking-row");
        entry.append(node("span", "", row.page_path), node("strong", "", String(row.views || 0)));
        dom.pageList.append(entry);
      });
    }
  }

  let analyticsRequestId = 0;

  async function loadAnalytics() {
    // 期間を続けて切り替えたとき、遅れて届いた古い応答が新しい表示を上書きしないようにする。
    const requestId = ++analyticsRequestId;
    dom.analyticsPanel?.classList.add("is-loading");
    try {
      const body = await api(`/api/admin/analytics?days=${state.analyticsDays}`);
      if (requestId !== analyticsRequestId) return;
      renderAnalytics(body);
    } finally {
      if (requestId === analyticsRequestId) dom.analyticsPanel?.classList.remove("is-loading");
    }
  }

  function switchTab(tab, { focus = false } = {}) {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      // tablist は「選択中のタブだけがTab移動の対象」。残りは矢印キーで辿る。
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    dom.panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab;
    });
    if (tab === "analytics") {
      loadAnalytics().catch((error) => toast(error.message, "error"));
    }
  }

  function bindEvents() {
    dom.tabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (button) switchTab(button.dataset.tab);
    });

    // role="tab" を名乗る以上、左右矢印・Home・End での移動を用意する必要がある。
    dom.tabs.addEventListener("keydown", (event) => {
      const buttons = [...dom.tabs.querySelectorAll("[data-tab]")];
      const current = buttons.findIndex((button) => button.getAttribute("aria-selected") === "true");
      if (current < 0) return;

      let next = null;
      if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
      else if (event.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      if (next === null) return;

      event.preventDefault();
      switchTab(buttons[next].dataset.tab, { focus: true });
    });

    dom.photoInput.addEventListener("change", () => addFiles(dom.photoInput.files));
    ["dragenter", "dragover"].forEach((name) =>
      dom.dropZone.addEventListener(name, (event) => {
        event.preventDefault();
        dom.dropZone.classList.add("is-dragging");
      }),
    );
    ["dragleave", "drop"].forEach((name) =>
      dom.dropZone.addEventListener(name, (event) => {
        event.preventDefault();
        dom.dropZone.classList.remove("is-dragging");
      }),
    );
    dom.dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

    dom.queue.addEventListener("input", (event) => {
      const id = event.target.dataset.queueAlt;
      const item = state.queue.find((candidate) => candidate.id === id);
      if (item) item.alt = event.target.value;
    });
    dom.queue.addEventListener("click", (event) => {
      const id = event.target.dataset.removeQueue;
      if (!id) return;
      const item = state.queue.find((candidate) => candidate.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      state.queue = state.queue.filter((candidate) => candidate.id !== id);
      renderQueue();
    });
    dom.uploadButton.addEventListener("click", uploadQueue);
    dom.refreshItems.addEventListener("click", () => loadItems().then(() => toast("一覧を更新しました。")).catch((error) => toast(error.message, "error")));
    dom.filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.filter = button.dataset.filter;
      dom.filters.querySelectorAll("[data-filter]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
      renderLibrary();
    });
    dom.library.addEventListener("change", handleLibraryChange);
    dom.library.addEventListener("click", handleLibraryClick);
    dom.analyticsRange.addEventListener("change", () => {
      state.analyticsDays = Number(dom.analyticsRange.value);
      loadAnalytics().catch((error) => toast(error.message, "error"));
    });
  }

  async function init() {
    bindEvents();
    renderQueue();
    try {
      const session = await api("/api/admin/session");
      setConnection(`${session.admin.email} で接続中`, "ready");
      watchChartResize();
      // 片方の失敗でもう片方を巻き添えにしない。以前は Promise.all だったため、
      // 集計APIが落ちると読み込み済みの写真一覧がエラー文で上書きされていた。
      await Promise.all([
        loadItems().catch((error) => {
          dom.library.replaceChildren(node("p", "empty-state", `写真を読み込めませんでした：${error.message}`));
          toast(error.message, "error");
        }),
        loadAnalytics().catch((error) => {
          dom.dailyChart.replaceChildren(node("p", "empty-state", `アクセス集計を読み込めませんでした：${error.message}`));
          toast(error.message, "error");
        }),
      ]);
    } catch (error) {
      setConnection(error.message, "error");
      dom.library.replaceChildren(node("p", "empty-state", error.message));
      toast(error.message, "error");
    }
  }

  init();
})();
