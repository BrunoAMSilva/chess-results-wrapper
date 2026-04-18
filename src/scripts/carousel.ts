type CarouselInstance = ReturnType<typeof initCarousel>;

function chunkElements<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(1, size);
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }

  return chunks;
}

function initDynamicPairingsPagination(
  container: HTMLElement,
  onRebuild: () => void,
) {
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-carousel-item]"));

  if (items.length === 0) {
    return { refresh: () => {}, disconnect: () => {} };
  }

  const measurePage = document.createElement("div");
  measurePage.className = "carousel-page pairings-page carousel-measure";
  measurePage.setAttribute("aria-hidden", "true");

  let resizeFrame = 0;
  let lastCapacity = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  function cloneItems(chunk: HTMLElement[]) {
    return chunk.map((item) => item.cloneNode(true) as HTMLElement);
  }

  function measurePageFits(chunk: HTMLElement[], availableHeight: number): boolean {
    measurePage.replaceChildren(...cloneItems(chunk));
    return measurePage.scrollHeight <= availableHeight + 1;
  }

  function resolveItemsPerPage(): number {
    const availableHeight = container.clientHeight;
    const availableWidth = container.clientWidth;

    if (availableHeight <= 0 || availableWidth <= 0) {
      return lastCapacity || 1;
    }

    container.append(measurePage);

    let upperBound = 1;
    measurePage.replaceChildren(...cloneItems(items));

    const visibleItems = Array.from(
      measurePage.children as HTMLCollectionOf<HTMLElement>,
    ).filter(
      (item) => item.offsetTop + item.offsetHeight <= availableHeight + 1,
    );

    upperBound = Math.max(1, visibleItems.length);

    for (let candidate = upperBound; candidate >= 1; candidate -= 1) {
      const pages = chunkElements(items, candidate);
      const fitsEveryPage = pages.every((page) => measurePageFits(page, availableHeight));

      if (fitsEveryPage) {
        measurePage.remove();
        return candidate;
      }
    }

    measurePage.remove();
    return 1;
  }

  function rebuild() {
    if (container.offsetParent === null && container.clientHeight === 0) {
      return;
    }

    const currentWidth = container.clientWidth;
    const currentHeight = container.clientHeight;
    const nextCapacity = resolveItemsPerPage();
    const sizeUnchanged =
      nextCapacity === lastCapacity &&
      currentWidth === lastWidth &&
      currentHeight === lastHeight;

    if (sizeUnchanged) {
      return;
    }

    lastCapacity = nextCapacity;
    lastWidth = currentWidth;
    lastHeight = currentHeight;
    const pages = chunkElements(items, nextCapacity);
    const fragment = document.createDocumentFragment();

    pages.forEach((pageItems, pageIndex) => {
      const page = document.createElement("div");
      page.className = "carousel-page pairings-page";
      page.dataset.page = String(pageIndex);

      if (pageIndex === 0) {
        page.classList.add("active");
      }

      page.append(...pageItems);
      fragment.append(page);
    });

    container.replaceChildren(fragment);
    container.dataset.totalPages = String(pages.length);
    onRebuild();
  }

  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(rebuild);
  });

  resizeObserver.observe(container);

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => rebuild()).catch(() => rebuild());
  }

  rebuild();

  return {
    refresh: rebuild,
    disconnect: () => {
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      measurePage.remove();
    },
  };
}

function initCarousel(container: HTMLElement) {
  const interval = Number.parseInt(container.dataset.interval || "10", 10) * 1000;
  const wrapper = container.closest("[data-carousel-group]") || container.parentElement!;
  const dotsContainer = wrapper.querySelector<HTMLElement>(".page-dots");
  const footer = wrapper.querySelector<HTMLElement>(".carousel-footer");
  const progressFill = wrapper.querySelector<HTMLElement>(".progress-fill");
  let current = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let animFrame: number = 0;
  let dynamicPagination:
    | { refresh: () => void; disconnect: () => void }
    | null = null;

  function getPages() {
    return Array.from(container.querySelectorAll<HTMLElement>(".carousel-page"));
  }

  function getTotalPages() {
    return getPages().length;
  }

  function renderDots() {
    if (!dotsContainer) {
      return;
    }

    const totalPages = getTotalPages();
    const existingDots = Array.from(dotsContainer.querySelectorAll<HTMLElement>(".page-dot"));

    if (existingDots.length === totalPages) {
      existingDots.forEach((dot, index) => {
        dot.dataset.dot = String(index);
        dot.setAttribute("aria-label", `Page ${index + 1}`);
      });
      return;
    }

    dotsContainer.replaceChildren();

    for (let index = 0; index < totalPages; index += 1) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "page-dot";
      dot.dataset.dot = String(index);
      dot.setAttribute("aria-label", `Page ${index + 1}`);
      dotsContainer.append(dot);
    }
  }

  function syncFooter() {
    const totalPages = getTotalPages();

    if (footer) {
      footer.classList.toggle("hidden", totalPages <= 1);
    }

    if (progressFill && totalPages <= 1) {
      progressFill.style.transition = "none";
      progressFill.style.width = "0%";
    }
  }

  function showPage(idx: number) {
    const pages = getPages();
    const totalPages = pages.length;

    if (totalPages === 0) {
      return;
    }

    const nextIndex = ((idx % totalPages) + totalPages) % totalPages;

    pages.forEach((p, i) => {
      p.classList.toggle("active", i === nextIndex);
      p.classList.toggle("exit", i !== nextIndex);
    });
    dotsContainer
      ?.querySelectorAll<HTMLElement>(".page-dot")
      .forEach((dot, i) => dot.classList.toggle("active", i === nextIndex));
    current = nextIndex;
    startProgress();
  }

  function startProgress() {
    const totalPages = getTotalPages();

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
    showPage(current + 1);
  }

  function start() {
    const totalPages = getTotalPages();

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

  function refresh(resetIndex = false) {
    renderDots();
    syncFooter();

    if (resetIndex) {
      current = 0;
    }

    const totalPages = getTotalPages();

    if (totalPages === 0) {
      stop();
      return;
    }

    if (current >= totalPages) {
      current = totalPages - 1;
    }

    showPage(current);
  }

  dotsContainer?.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const dot = target.closest<HTMLElement>(".page-dot");

    if (!dot) {
      return;
    }

    stop();
    showPage(Number.parseInt(dot.dataset.dot || "0", 10));
    start();
  });

  if (container.dataset.dynamicPagination === "pairings") {
    dynamicPagination = initDynamicPairingsPagination(container, () => {
      stop();
      refresh(true);
      start();
    });
  }

  refresh(true);
  start();

  return {
    start,
    stop,
    showPage,
    refresh,
    disconnect() {
      stop();
      dynamicPagination?.disconnect();
    },
  };
}

// Initialize all carousels on the page
const instances = new Map<string, CarouselInstance>();

function initAllCarousels() {
  // Disconnect and clear stale instances from the previous page
  instances.forEach((inst) => inst.disconnect());
  instances.clear();

  document.querySelectorAll<HTMLElement>(".carousel").forEach((el) => {
    if (el.id) {
      instances.set(el.id, initCarousel(el));
    }
  });

  // Tab switching for standings — supports both old standingsTabs and new TabsControl.
  // Re-query the tab container on every init because view transitions replace the DOM.
  const tabContainer = document.getElementById("standingsTabs") || document.querySelector('[data-tabs-control="standings"]');
  if (tabContainer) {
    const openSection = document.getElementById("openStandings");
    const womenSection = document.getElementById("womenStandings");

    // Listen for the new TabsControl custom event
    tabContainer.addEventListener("tab-change", ((e: CustomEvent) => {
      const target = e.detail.value;

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
    }) as EventListener);

    // Also support old-style standalone tabs (fallback)
    const oldTabs = tabContainer.querySelectorAll<HTMLElement>(".standings-tab");
    if (oldTabs.length > 0) {
      oldTabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          const target = tab.dataset.tab;
          oldTabs.forEach((t) => t.classList.toggle("active", t === tab));

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
    }

    // Stop women carousel initially (it starts hidden)
    instances.get("womenCarousel")?.stop();
  }
}

// Keyboard navigation for the visible carousel.
// Attached once at module level — always references the live instances Map.
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    // Find the currently active (visible) carousel and navigate it
    for (const [id, inst] of instances) {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null) {
        inst.stop();
        const totalPages = Number.parseInt(el.dataset.totalPages || "1", 10);
        // Navigate via showPage - get current page from active class
        const activePage = el.querySelector(".carousel-page.active");
        const currentIdx = activePage ? Number.parseInt(activePage.getAttribute("data-page") || "0", 10) : 0;
        if (e.key === "ArrowRight") inst.showPage((currentIdx + 1) % totalPages);
        else inst.showPage((currentIdx - 1 + totalPages) % totalPages);
        inst.start();
        break;
      }
    }
  }
});

document.addEventListener("DOMContentLoaded", initAllCarousels);
document.addEventListener("astro:after-swap", initAllCarousels);

window.addEventListener("beforeunload", () => {
  instances.forEach((instance) => instance.disconnect());
});
