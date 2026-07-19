try {
  const revealItems = document.querySelectorAll(".reveal-media, .reveal-copy");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  } else {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px 18%", threshold: 0.01 },
    );

    revealItems.forEach((item) => revealObserver.observe(item));
  }

  window.clearTimeout(window.__motionFallbackTimer);
} catch {
  document.documentElement.classList.add("motion-fallback");
}
