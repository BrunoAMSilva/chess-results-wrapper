function initDesktopSidebar() {
  const shell = document.querySelector<HTMLElement>("[data-sidebar-shell]");
  const toggle = document.querySelector<HTMLButtonElement>("[data-sidebar-toggle]");

  if (!shell || !toggle) {
    return;
  }

  const collapseLabel = toggle.dataset.collapseLabel || "Collapse navigation";
  const expandLabel = toggle.dataset.expandLabel || "Expand navigation";

  const applyState = (collapsed: boolean) => {
    shell.dataset.sidebarState = collapsed ? "collapsed" : "expanded";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");

    const label = collapsed ? expandLabel : collapseLabel;
    toggle.setAttribute("aria-label", label);
    toggle.title = label;

    const srOnlyLabel = toggle.querySelector<HTMLElement>(".desktop-sidebar__sr-only");
    if (srOnlyLabel) {
      srOnlyLabel.textContent = label;
    }
  };

  if (toggle.dataset.sidebarBound !== "true") {
    toggle.addEventListener("click", () => {
      applyState(shell.dataset.sidebarState !== "collapsed");
    });
    toggle.dataset.sidebarBound = "true";
  }

  applyState(shell.dataset.sidebarState === "collapsed");
}

if (!(window as Window & { __desktopSidebarBound?: boolean }).__desktopSidebarBound) {
  document.addEventListener("astro:after-swap", initDesktopSidebar);
  (window as Window & { __desktopSidebarBound?: boolean }).__desktopSidebarBound = true;
}

initDesktopSidebar();