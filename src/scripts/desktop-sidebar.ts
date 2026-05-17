function initDesktopSidebar() {
  const shell = document.querySelector<HTMLElement>("[data-sidebar-shell]");
  const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-sidebar-toggle]"));

  if (!shell || toggles.length === 0) {
    return;
  }

  const applyState = (collapsed: boolean) => {
    shell.dataset.sidebarState = collapsed ? "collapsed" : "expanded";

    for (const toggle of toggles) {
      const collapseLabel = toggle.dataset.collapseLabel || "Collapse navigation";
      const expandLabel = toggle.dataset.expandLabel || "Expand navigation";
      const label = collapsed ? expandLabel : collapseLabel;

      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.setAttribute("aria-label", label);
      toggle.title = label;

      const labelTarget = toggle.querySelector<HTMLElement>("[data-sidebar-toggle-label]");
      if (labelTarget) {
        labelTarget.textContent = label;
      }
    }
  };

  for (const toggle of toggles) {
    if (toggle.dataset.sidebarBound !== "true") {
      toggle.addEventListener("click", () => {
        applyState(shell.dataset.sidebarState !== "collapsed");
      });
      toggle.dataset.sidebarBound = "true";
    }
  }

  applyState(shell.dataset.sidebarState === "collapsed");
}

if (!(window as Window & { __desktopSidebarBound?: boolean }).__desktopSidebarBound) {
  document.addEventListener("astro:after-swap", initDesktopSidebar);
  (window as Window & { __desktopSidebarBound?: boolean }).__desktopSidebarBound = true;
}

initDesktopSidebar();