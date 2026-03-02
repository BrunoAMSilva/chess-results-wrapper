function initCarousel(container: HTMLElement) {
  const totalPages = parseInt(container.dataset.totalPages || "1");
  const interval = parseInt(container.dataset.interval || "10") * 1000;
  const pages = container.querySelectorAll<HTMLElement>(".carousel-page");
  const wrapper = container.closest("[data-carousel-group]") || container.parentElement!;
  const dots = wrapper.querySelectorAll<HTMLElement>(".page-dot");
  const progressFill = wrapper.querySelector<HTMLElement>(".progress-fill");
  let current = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let animFrame: number = 0;

  function showPage(idx: number) {
    pages.forEach((p, i) => {
      p.classList.toggle("active", i === idx);
      p.classList.toggle("exit", i !== idx);
    });
    dots.forEach((d, i) => d.classList.toggle("active", i === idx));
    current = idx;
    startProgress();
  }

  function startProgress() {
    if (!progressFill || totalPages <= 1) return;
    cancelAnimationFrame(animFrame);
    progressFill.style.transition = "none";
    progressFill.style.width = "0%";

    requestAnimationFrame(() => {
      progressFill.style.transition = `width ${interval}ms linear`;
      progressFill.style.width = "100%";
    });
  }

  function nextPage() {
    showPage((current + 1) % totalPages);
  }

  function start() {
    if (totalPages > 1 && !timer) {
      timer = setInterval(nextPage, interval);
      startProgress();
    }
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    cancelAnimationFrame(animFrame);
  }

  if (totalPages > 1) {
    start();

    dots.forEach((dot) => {
      dot.addEventListener("click", () => {
        stop();
        showPage(parseInt(dot.dataset.dot || "0"));
        start();
      });
    });
  }

  return { start, stop, showPage };
}

// Initialize all carousels on the page
const carousels = document.querySelectorAll<HTMLElement>(".carousel");
const instances = new Map<string, ReturnType<typeof initCarousel>>();

carousels.forEach((el) => {
  const instance = initCarousel(el);
  instances.set(el.id, instance);
});

// Keyboard navigation for the visible carousel
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    // Find the currently active (visible) carousel and navigate it
    for (const [id, inst] of instances) {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null) {
        inst.stop();
        const totalPages = parseInt(el.dataset.totalPages || "1");
        // Navigate via showPage - get current page from active class
        const activePage = el.querySelector(".carousel-page.active");
        const currentIdx = activePage ? parseInt(activePage.getAttribute("data-page") || "0") : 0;
        if (e.key === "ArrowRight") inst.showPage((currentIdx + 1) % totalPages);
        else inst.showPage((currentIdx - 1 + totalPages) % totalPages);
        inst.start();
        break;
      }
    }
  }
});

// Tab switching for standings
const tabContainer = document.getElementById("standingsTabs");
if (tabContainer) {
  const tabs = tabContainer.querySelectorAll<HTMLElement>(".standings-tab");
  const openSection = document.getElementById("openStandings");
  const womenSection = document.getElementById("womenStandings");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));

      if (target === "open") {
        openSection?.classList.remove("hidden");
        womenSection?.classList.add("hidden");
        instances.get("womenCarousel")?.stop();
        instances.get("carousel")?.start();
      } else {
        openSection?.classList.add("hidden");
        womenSection?.classList.remove("hidden");
        instances.get("carousel")?.stop();
        instances.get("womenCarousel")?.start();
      }
    });
  });

  // Stop women carousel initially (it starts hidden)
  instances.get("womenCarousel")?.stop();
}
