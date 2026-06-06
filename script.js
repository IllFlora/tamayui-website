const loader = document.querySelector(".page-loader");
let loaderSeen = false;

try {
  loaderSeen = sessionStorage.getItem("tamayui-loader-seen") === "true";
  sessionStorage.setItem("tamayui-loader-seen", "true");
} catch {
  loaderSeen = false;
}

if (loaderSeen) {
  loader.classList.add("skip");
} else {
  const hideLoader = () => loader.classList.add("done");
  window.addEventListener("load", () => {
    window.setTimeout(hideLoader, 750);
  });
  window.setTimeout(hideLoader, 2500);
}

const menuButton = document.querySelector(".menu-button");
const navigation = document.querySelector(".site-nav");

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  navigation.classList.toggle("open", !isOpen);
  document.body.classList.toggle("menu-open", !isOpen);
});

navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton.setAttribute("aria-expanded", "false");
    navigation.classList.remove("open");
    document.body.classList.remove("menu-open");
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
