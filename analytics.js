(() => {
  const endpoint = "/api/events";
  const sessionKey = "tamayui.analytics.session.v1";
  const sessionLifetime = 30 * 60 * 1000;
  const allowedEvents = new Set([
    "line_click",
    "instagram_click",
    "note_click",
    "gallery_click",
  ]);

  if (navigator.doNotTrack === "1") return;

  function randomId() {
    if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "");
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function getSessionId() {
    const now = Date.now();
    try {
      const current = JSON.parse(localStorage.getItem(sessionKey) || "null");
      if (current?.id && now - Number(current.lastSeen || 0) < sessionLifetime) {
        localStorage.setItem(sessionKey, JSON.stringify({ id: current.id, lastSeen: now }));
        return current.id;
      }
      const id = randomId();
      localStorage.setItem(sessionKey, JSON.stringify({ id, lastSeen: now }));
      return id;
    } catch {
      return randomId();
    }
  }

  const sessionId = getSessionId();
  const params = new URLSearchParams(location.search);
  const campaign = {
    utmSource: params.get("utm_source") || "",
    utmMedium: params.get("utm_medium") || "",
    utmCampaign: params.get("utm_campaign") || "",
  };

  function send(eventName, details = {}) {
    const payload = JSON.stringify({
      eventName,
      sessionId,
      pagePath: location.pathname,
      target: details.target || "",
      experimentKey: details.experimentKey || "",
      variant: details.variant || "",
      ...campaign,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
      return;
    }

    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }

  function inferEvent(link) {
    const explicit = link.dataset.track;
    if (allowedEvents.has(explicit)) return explicit;

    let url;
    try {
      url = new URL(link.href, location.href);
    } catch {
      return "";
    }
    if (url.hostname === "lin.ee") return "line_click";
    if (url.hostname.includes("instagram.com")) return "instagram_click";
    if (url.hostname === "note.com") return "note_click";
    if (url.pathname.endsWith("lessons.html") || url.pathname.endsWith("works.html")) return "gallery_click";
    return "";
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const eventName = inferEvent(link);
    if (!eventName) return;

    const experiment = link.closest("[data-experiment-key]");
    send(eventName, {
      target: link.dataset.trackId || link.textContent.replace(/\s+/g, " ").trim().slice(0, 100),
      experimentKey: experiment?.dataset.experimentKey || "",
      variant: experiment?.dataset.variant || "",
    });
  });

  send("page_view", { target: document.title });
})();
