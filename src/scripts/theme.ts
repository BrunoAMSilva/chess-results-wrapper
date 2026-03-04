/**
 * Theme Manager — handles dark/light mode with system preference fallback.
 *
 * Persists user choice in localStorage under `theme`.
 * Values: "light" | "dark" | "system" (or absent = system)
 *
 * This script runs inline in <head> to prevent FOUC.
 */
(function () {
  const STORAGE_KEY = "theme";

  function getSystemTheme(): "light" | "dark" {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function applyTheme(pref: string | null) {
    if (pref === "light" || pref === "dark") {
      document.documentElement.setAttribute("data-theme", pref);
    } else {
      // system preference — remove attribute so CSS @media kicks in
      document.documentElement.removeAttribute("data-theme");
    }
  }

  function getStoredTheme(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  // Apply immediately
  applyTheme(getStoredTheme());

  // Listen for system theme changes
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      const stored = getStoredTheme();
      if (!stored || stored === "system") {
        applyTheme(null);
      }
    });

  // Expose global API for theme toggle
  (window as any).__setTheme = function (pref: "light" | "dark" | "system") {
    try {
      if (pref === "system") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, pref);
      }
    } catch {}
    applyTheme(pref === "system" ? null : pref);
  };

  (window as any).__getTheme = function (): "light" | "dark" | "system" {
    const stored = getStoredTheme();
    if (stored === "light" || stored === "dark") return stored;
    return "system";
  };

  (window as any).__getResolvedTheme = function (): "light" | "dark" {
    const stored = getStoredTheme();
    if (stored === "light" || stored === "dark") return stored;
    return getSystemTheme();
  };
})();
