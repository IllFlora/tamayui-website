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

    const webp = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!webp) throw new Error(`${file.name} を軽量化できませんでした。`);
    const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "tamayui-photo";
    const optimized = new File([webp], `${baseName}.webp`, { type: "image/webp" });
    return {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      file: optimized,
      originalName: file.name,
      preview: URL.createObjectURL(webp),
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
    document.querySelector(id).textContent = value;
  }

  function renderAnalytics(data) {
    const summary = data.summary || {};
    renderMetric("#metric-sessions", Number(summary.sessions || 0).toLocaleString("ja-JP"));
    renderMetric("#metric-pageviews", Number(summary.pageViews || 0).toLocaleString("ja-JP"));
    renderMetric("#metric-line-clicks", Number(summary.lineClicks || 0).toLocaleString("ja-JP"));
    renderMetric("#metric-line-sessions", `${Number(summary.lineSessions || 0).toLocaleString("ja-JP")}セッション`);
    renderMetric("#metric-cv", `${Number(summary.lineTransitionRate || 0).toFixed(1)}%`);

    dom.dailyChart.replaceChildren();
    const daily = data.daily || [];
    const maxValue = Math.max(1, ...daily.flatMap((row) => [Number(row.page_views || 0), Number(row.line_sessions || 0)]));
    if (!daily.length) {
      dom.dailyChart.append(node("p", "empty-state", "計測データがまだありません。公開後のアクセスから蓄積されます。"));
    } else {
      daily.forEach((row) => {
        const group = node("div", "chart-day");
        group.title = `${row.day}: 閲覧 ${row.page_views || 0} / LINE ${row.line_sessions || 0}`;
        const views = document.createElement("i");
        views.style.height = `${Math.max(2, (Number(row.page_views || 0) / maxValue) * 170)}px`;
        const line = document.createElement("i");
        line.style.height = `${Math.max(2, (Number(row.line_sessions || 0) / maxValue) * 170)}px`;
        const date = document.createElement("time");
        date.dateTime = row.day;
        date.textContent = row.day.slice(5).replace("-", "/");
        group.append(views, line, date);
        dom.dailyChart.append(group);
      });
    }

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

  async function loadAnalytics() {
    const body = await api(`/api/admin/analytics?days=${state.analyticsDays}`);
    renderAnalytics(body);
  }

  function switchTab(tab) {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
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
      await Promise.all([loadItems(), loadAnalytics()]);
    } catch (error) {
      setConnection(error.message, "error");
      dom.library.replaceChildren(node("p", "empty-state", error.message));
      toast(error.message, "error");
    }
  }

  init();
})();
