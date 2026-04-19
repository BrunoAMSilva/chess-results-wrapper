/**
 * Winners Presentation — client-side controller.
 *
 * Flow:
 *   1. Page loads → show cinematic intro (tournament name + sponsor)
 *   2. Space / Enter / click → exit intro, reveal first player
 *   3. Subsequent interactions → advance through players
 *   4. After last player → navigate to /present/standings
 */

import type { Standing } from "../lib/types";
import { reverseName } from "../lib/utils";

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

let standings: Standing[] = [];
let currentIndex = -1; // -1 = nothing shown yet
let tournamentId = "";
let tournamentName = "";
let tournamentDate = "";
let tournamentLocation = "";
let sponsorImage = "";
let sponsorAlt = "";
let startRank = 3;
let totalPlayers = 0;
let lang = "0";
let busy = false;
let introActive = true; // starts with intro visible

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

function init(): void {
  const dataEl = document.getElementById("standings-data");
  if (!dataEl?.textContent) return;

  try {
    standings = JSON.parse(dataEl.textContent);
  } catch {
    return;
  }

  const stage = document.getElementById("winnersStage");
  if (!stage) return;

  tournamentId = stage.dataset.tournamentId ?? "";
  tournamentName = stage.dataset.tournamentName ?? "";
  tournamentDate = stage.dataset.tournamentDate ?? "";
  tournamentLocation = stage.dataset.tournamentLocation ?? "";
  sponsorImage = stage.dataset.sponsorImage ?? "";
  sponsorAlt = stage.dataset.sponsorAlt ?? "Sponsor";
  startRank = parseInt(stage.dataset.startRank ?? "3", 10);
  totalPlayers = parseInt(stage.dataset.totalPlayers ?? "0", 10);
  lang = stage.dataset.lang ?? "0";

  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onClick);

  // Show intro
  showIntro();
}

/* ------------------------------------------------------------------ */
/*  Event handlers                                                     */
/* ------------------------------------------------------------------ */

function onKey(e: KeyboardEvent): void {
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    advance();
  }
}

function onClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  if (t.closest("a, button, kbd")) return;
  advance();
}

/* ------------------------------------------------------------------ */
/*  Advance: intro → players → standings redirect                      */
/* ------------------------------------------------------------------ */

async function advance(): Promise<void> {
  if (busy) return;

  if (introActive) {
    busy = true;
    await exitIntro();
    introActive = false;
    // Show nav hint for player cards
    const hint = document.getElementById("navHint");
    if (hint) {
      hint.classList.remove("hidden");
      setTimeout(() => hint.classList.add("hidden"), 4000);
    }
    // Show first player
    await showPlayer(0);
    busy = false;
    return;
  }

  const nextIndex = currentIndex + 1;

  // Past the last player → navigate to standings
  if (nextIndex >= standings.length) {
    busy = true;
    await exitCurrent();
    window.location.href = `/present/standings?tid=${tournamentId}&lang=${lang}`;
    return;
  }

  busy = true;

  // Exit current card (if any)
  if (currentIndex >= 0) {
    await exitCurrent();
  }

  await showPlayer(nextIndex);
  busy = false;
}

/* ------------------------------------------------------------------ */
/*  Intro                                                              */
/* ------------------------------------------------------------------ */

function showIntro(): void {
  const slot = document.getElementById("playerSlot");
  if (!slot) return;

  slot.innerHTML = buildIntro();

  // Force reflow
  slot.offsetHeight;

  const intro = slot.querySelector(".wc-intro") as HTMLElement | null;
  if (intro) {
    requestAnimationFrame(() => intro.classList.add("in"));
  }

  // Wire rank picker
  const picker = document.getElementById("rankPicker");
  if (picker) {
    picker.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".wc-rank-btn");
      if (!btn) return;
      e.stopPropagation(); // don't trigger advance

      const delta = parseInt(btn.dataset.delta ?? "0", 10);
      const newRank = Math.max(1, Math.min(totalPlayers, startRank + delta));
      if (newRank === startRank) return;

      // Reload with new startRank
      const url = new URL(window.location.href);
      url.searchParams.set("startRank", String(newRank));
      window.location.href = url.toString();
    });
  }
}

function exitIntro(): Promise<void> {
  return new Promise((resolve) => {
    const slot = document.getElementById("playerSlot");
    const intro = slot?.querySelector(".wc-intro") as HTMLElement | null;
    if (!intro) { resolve(); return; }

    intro.classList.remove("in");
    intro.classList.add("out");

    setTimeout(() => {
      intro.remove();
      resolve();
    }, 500);
  });
}

function buildIntro(): string {
  const hasSponsor = !!sponsorImage;
  const noSponsorClass = hasSponsor ? "" : " wc-intro--no-sponsor";

  const sponsorHTML = hasSponsor
    ? `<div class="wc-intro-sponsor-wrap">
        <img class="wc-intro-sponsor" src="${sponsorImage}" alt="${sponsorAlt}" />
      </div>
      <div class="wc-intro-divider"></div>`
    : `<div class="wc-intro-divider"></div>`;

  const dateHTML = tournamentDate
    ? `<p class="wc-intro-date">${tournamentDate}</p>`
    : "";

  const locationHTML = tournamentLocation
    ? `<p class="wc-intro-location">${tournamentLocation}</p>`
    : "";

  return `
<div class="wc-intro${noSponsorClass}">
  <div class="wc-intro-glow"></div>

  <div class="wc-intro-particles">
    <div class="wc-intro-particle"></div>
    <div class="wc-intro-particle"></div>
    <div class="wc-intro-particle"></div>
    <div class="wc-intro-particle"></div>
    <div class="wc-intro-particle"></div>
    <div class="wc-intro-particle"></div>
    <div class="wc-intro-particle"></div>
    <div class="wc-intro-particle"></div>
  </div>

  <div class="wc-intro-corner wc-intro-corner--tl"></div>
  <div class="wc-intro-corner wc-intro-corner--tr"></div>
  <div class="wc-intro-corner wc-intro-corner--bl"></div>
  <div class="wc-intro-corner wc-intro-corner--br"></div>

  <div class="wc-intro-content">
    ${sponsorHTML}
    <div class="wc-intro-title-block">
      <h1 class="wc-intro-title">${tournamentName}</h1>
      ${dateHTML}
      ${locationHTML}
    </div>
    <p class="wc-intro-subtitle">Winners Ceremony</p>
  </div>

  <div class="wc-intro-hint">Press <kbd>Space</kbd> to begin</div>
</div>`;
}

/* ------------------------------------------------------------------ */
/*  Show a player card                                                 */
/* ------------------------------------------------------------------ */

async function showPlayer(index: number): Promise<void> {
  currentIndex = index;
  const standing = standings[currentIndex];

  const slot = document.getElementById("playerSlot");
  if (!slot) return;

  slot.innerHTML = buildCard(standing);

  // Force reflow
  slot.offsetHeight;

  const card = slot.querySelector(".wc") as HTMLElement | null;
  if (card) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        card.classList.add("in");
        setTimeout(resolve, 900);
      });
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Exit animation                                                     */
/* ------------------------------------------------------------------ */

function exitCurrent(): Promise<void> {
  return new Promise((resolve) => {
    const slot = document.getElementById("playerSlot");
    const card = slot?.querySelector(".wc") as HTMLElement | null;
    if (!card) { resolve(); return; }

    card.classList.remove("in");
    card.classList.add("out");

    setTimeout(() => {
      card.remove();
      resolve();
    }, 500);
  });
}

/* ------------------------------------------------------------------ */
/*  Build card HTML                                                    */
/* ------------------------------------------------------------------ */

function buildCard(s: Standing): string {
  const rank = s.rank;

  // Medal config
  const medalConfig = getMedalConfig(rank);

  // Name
  const displayName = reverseName(s.name);

  // Photo
  const photoUrl = s.fideId ? `/api/player-photo/fide_${s.fideId}.jpg` : "";
  const initials = displayName.split(" ").slice(0, 2).map((w) => w[0]).join("");

  const photoHTML = photoUrl
    ? `<img class="wc-photo-img" src="${photoUrl}" alt="" />`
    : `<div class="wc-photo-fallback"><span>${initials}</span></div>`;

  const titleHTML = s.title
    ? `<span class="wc-title-badge">${s.title}</span>`
    : "";

  const clubHTML = s.club
    ? `<div class="wc-meta-row"><span class="wc-meta-value">${s.club}</span></div>`
    : "";

  const fedHTML = s.fed
    ? `<span class="wc-fed">${s.fed}</span>`
    : "";

  return `
<div class="wc">
  <!-- Photo (left) -->
  <div class="wc-photo">
    ${photoHTML}
  </div>

  <!-- Blades -->
  <div class="wc-blade wc-blade-1"></div>
  <div class="wc-blade wc-blade-2"></div>

  <!-- Info (right) -->
  <div class="wc-info">
    <div class="wc-info-inner">
      <div class="wc-medal ${medalConfig.cssClass}">
        ${medalConfig.iconHTML}
        <span class="wc-medal-label">${medalConfig.label}</span>
      </div>

      ${titleHTML}

      <h1 class="wc-name">${displayName}</h1>

      <div class="wc-meta">
        ${clubHTML}
        ${fedHTML}
      </div>
    </div>
  </div>
</div>`;
}

/* ------------------------------------------------------------------ */
/*  Medal helpers                                                      */
/* ------------------------------------------------------------------ */

interface MedalConfig {
  cssClass: string;
  iconHTML: string;
  label: string;
}

function getMedalConfig(rank: number): MedalConfig {
  switch (rank) {
    case 1:
      return {
        cssClass: "wc-medal--gold",
        iconHTML: `<span class="wc-medal-icon">\u{1F947}</span>`,
        label: "1st Place",
      };
    case 2:
      return {
        cssClass: "wc-medal--silver",
        iconHTML: `<span class="wc-medal-icon">\u{1F948}</span>`,
        label: "2nd Place",
      };
    case 3:
      return {
        cssClass: "wc-medal--bronze",
        iconHTML: `<span class="wc-medal-icon">\u{1F949}</span>`,
        label: "3rd Place",
      };
    default:
      return {
        cssClass: "",
        iconHTML: `<span class="wc-medal-badge">${rank}</span>`,
        label: `${rank}th Place`,
      };
  }
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

document.addEventListener("astro:after-swap", () => {
  currentIndex = -1;
  busy = false;
  introActive = true;
  init();
});
