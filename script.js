const menuButton = document.querySelector(".menu-button");
const navigation = document.querySelector(".site-nav");
const menuLabel = menuButton.querySelector(".sr-only");

const setMenuOpen = (isOpen) => {
  menuButton.setAttribute("aria-expanded", String(isOpen));
  menuLabel.textContent = isOpen ? "メニューを閉じる" : "メニューを開く";
  navigation.classList.toggle("open", isOpen);
  document.body.classList.toggle("menu-open", isOpen);
};

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  setMenuOpen(!isOpen);
});

navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    setMenuOpen(false);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || menuButton.getAttribute("aria-expanded") !== "true") return;
  setMenuOpen(false);
  menuButton.focus();
});

const revealElements = document.querySelectorAll(".reveal");

if (!("IntersectionObserver" in window)) {
  revealElements.forEach((element) => element.classList.add("visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px 15%", threshold: 0.01 },
  );

  revealElements.forEach((element) => observer.observe(element));
}
