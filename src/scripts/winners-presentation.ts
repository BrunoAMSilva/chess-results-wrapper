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
let lang = "0";
let busy = false;
let introActive = true; // starts with intro visible
let stopParticles: (() => void) | null = null;

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

  // Start canvas particles around sponsor card
  stopParticles = startSponsorParticles();
}

function exitIntro(): Promise<void> {
  return new Promise((resolve) => {
    if (stopParticles) { stopParticles(); stopParticles = null; }

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

/* ------------------------------------------------------------------ */
/*  Canvas particle system for sponsor card                            */
/* ------------------------------------------------------------------ */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  phase: number;     // sine wobble phase offset
  freq: number;      // sine wobble frequency
  wobbleAmp: number; // sine wobble amplitude
}

function startSponsorParticles(): (() => void) | null {
  const canvas = document.getElementById("sponsorCanvas") as HTMLCanvasElement | null;
  if (!canvas) return null;

  const stage = canvas.parentElement;
  if (!stage) return null;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Size canvas to match stage + margin (CSS inset: -3rem ≈ 48px each side)
  const dpr = window.devicePixelRatio || 1;
  const margin = 48;

  function resize() {
    const rect = stage!.getBoundingClientRect();
    const w = rect.width + margin * 2;
    const h = rect.height + margin * 2;
    canvas!.width = w * dpr;
    canvas!.height = h * dpr;
    canvas!.style.width = `${w}px`;
    canvas!.style.height = `${h}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  const PARTICLE_COUNT = 30;
  const GOLD_R = 252, GOLD_G = 211, GOLD_B = 77;
  const particles: Particle[] = [];

  function canvasW() { return canvas!.width / dpr; }
  function canvasH() { return canvas!.height / dpr; }

  // Spawn a particle along one of the four edges of the card area
  function spawnParticle(): Particle {
    const w = canvasW();
    const h = canvasH();
    const edgeBand = 20; // how far from the card edge particles spawn

    // Card bounds within the canvas (card is centered, margin on each side)
    const cardLeft = margin;
    const cardRight = w - margin;
    const cardTop = margin;
    const cardBottom = h - margin;

    // Pick a random edge: 0=top, 1=right, 2=bottom, 3=left
    const edge = Math.floor(Math.random() * 4);
    let x: number, y: number;

    switch (edge) {
      case 0: // top
        x = cardLeft + Math.random() * (cardRight - cardLeft);
        y = cardTop - Math.random() * edgeBand;
        break;
      case 1: // right
        x = cardRight + Math.random() * edgeBand;
        y = cardTop + Math.random() * (cardBottom - cardTop);
        break;
      case 2: // bottom
        x = cardLeft + Math.random() * (cardRight - cardLeft);
        y = cardBottom + Math.random() * edgeBand;
        break;
      default: // left
        x = cardLeft - Math.random() * edgeBand;
        y = cardTop + Math.random() * (cardBottom - cardTop);
        break;
    }

    // Gentle outward drift from card center
    const cx = w / 2, cy = h / 2;
    const angle = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 1.2;
    const speed = 0.15 + Math.random() * 0.35;

    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 3 + Math.random() * 6,
      life: 0,
      maxLife: 120 + Math.random() * 180, // 2–5s at 60fps
      phase: Math.random() * Math.PI * 2,
      freq: 0.02 + Math.random() * 0.03,
      wobbleAmp: 0.3 + Math.random() * 0.7,
    };
  }

  // Initialize all particles with staggered life so they don't all appear at once
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = spawnParticle();
    p.life = Math.floor(Math.random() * p.maxLife);
    particles.push(p);
  }

  let rafId = 0;
  let running = true;

  function draw() {
    if (!running) return;

    const w = canvasW();
    const h = canvasH();
    ctx!.clearRect(0, 0, w, h);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life++;

      // Respawn if expired
      if (p.life >= p.maxLife) {
        Object.assign(p, spawnParticle());
        continue;
      }

      // Lifecycle opacity: smooth fade in → hold → fade out
      const t = p.life / p.maxLife;
      let alpha: number;
      if (t < 0.15) {
        alpha = t / 0.15;           // fade in
      } else if (t > 0.75) {
        alpha = (1 - t) / 0.25;    // fade out
      } else {
        alpha = 1;                  // hold
      }
      // Add subtle flicker
      alpha *= 0.6 + 0.4 * Math.sin(p.life * 0.08 + p.phase);

      // Sine wobble perpendicular to travel direction
      const wobbleX = Math.sin(p.life * p.freq + p.phase) * p.wobbleAmp;
      const wobbleY = Math.cos(p.life * p.freq * 0.7 + p.phase) * p.wobbleAmp;

      p.x += p.vx + wobbleX;
      p.y += p.vy + wobbleY;

      // Size pulse
      const sizeScale = 0.85 + 0.15 * Math.sin(p.life * 0.04 + p.phase);
      const r = p.size * sizeScale * 0.5;

      // Draw glowing circle
      ctx!.save();
      ctx!.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx!.shadowColor = `rgba(${GOLD_R}, ${GOLD_G}, ${GOLD_B}, 0.8)`;
      ctx!.shadowBlur = r * 3;
      ctx!.fillStyle = `rgba(${GOLD_R}, ${GOLD_G}, ${GOLD_B}, 1)`;
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }

    rafId = requestAnimationFrame(draw);
  }

  rafId = requestAnimationFrame(draw);

  // Return cleanup function
  return () => {
    running = false;
    cancelAnimationFrame(rafId);
  };
}

function buildIntro(): string {
  const hasSponsor = !!sponsorImage;
  const noSponsorClass = hasSponsor ? "" : " wc-intro--no-sponsor";

  const sponsorHTML = hasSponsor
    ? `<div class="wc-sponsor-stage">
        <canvas class="wc-sponsor-canvas" id="sponsorCanvas"></canvas>
        <div class="wc-intro-sponsor-wrap">
          <img class="wc-intro-sponsor" src="${sponsorImage}" alt="${sponsorAlt}" />
        </div>
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
