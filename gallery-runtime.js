(() => {
  const mounts = Array.from(document.querySelectorAll("[data-managed-gallery]"));
  if (!mounts.length) return;

  function columnCount() {
    if (window.matchMedia("(max-width: 640px)").matches) return 1;
    if (window.matchMedia("(max-width: 980px)").matches) return 2;
    return 3;
  }

  function createFigure(item) {
    const figure = document.createElement("figure");
    figure.className = "managed-photo";
    const image = document.createElement("img");
    image.src = item.url;
    image.width = item.width;
    image.height = item.height;
    image.alt = item.alt || "タティングレースの写真";
    image.loading = "lazy";
    image.decoding = "async";
    figure.append(image);
    return figure;
  }

  function render(mount, items) {
    const wall = mount.querySelector("[data-gallery-wall]");
    if (!wall) return;
    wall.replaceChildren();

    const count = columnCount();
    const columns = Array.from({ length: count }, () => {
      const column = document.createElement("div");
      column.className = "managed-gallery-column";
      wall.append(column);
      return { node: column, weight: 0 };
    });

    items.forEach((item) => {
      const destination = columns.reduce((shortest, candidate) =>
        candidate.weight < shortest.weight ? candidate : shortest,
      );
      destination.node.append(createFigure(item));
      destination.weight += Number(item.height) / Math.max(Number(item.width), 1) + 0.08;
    });
  }

  async function hydrate(mount) {
    const collection = mount.dataset.managedGallery;
    try {
      const response = await fetch(`/api/gallery?collection=${encodeURIComponent(collection)}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const body = await response.json();
      if (!Array.isArray(body.items) || !body.items.length) return;

      mount.hidden = false;
      render(mount, body.items);
      let previousCount = columnCount();
      window.addEventListener(
        "resize",
        () => {
          const nextCount = columnCount();
          if (nextCount === previousCount) return;
          previousCount = nextCount;
          render(mount, body.items);
        },
        { passive: true },
      );
    } catch {
      // The static gallery remains the complete fallback until Cloudflare bindings are ready.
    }
  }

  mounts.forEach(hydrate);
})();
