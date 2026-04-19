import type { Standing } from "../lib/types";

let currentIndex = 0;
let standings: Standing[] = [];
let tournamentId: string = "";
let isNavigating = false;
let debounceTimer: number | null = null;

function initWinnersPresentation(): void {
  // Get standings data from script tag
  const dataElement = document.getElementById("standings-data");
  if (!dataElement) {
    console.error("Winners presentation: standings data not found");
    return;
  }

  try {
    standings = JSON.parse(dataElement.textContent || "[]");
  } catch (e) {
    console.error("Winners presentation: failed to parse standings", e);
    return;
  }

  // Get tournament ID from carousel container
  const carousel = document.querySelector(".winners-carousel");
  if (!carousel) {
    console.error("Winners presentation: carousel element not found");
    return;
  }

  tournamentId = carousel.getAttribute("data-tournament-id") || "";
  if (!tournamentId) {
    console.error("Winners presentation: tournament ID not found");
    return;
  }

  // Set up event listeners
  setupEventListeners();
}

function setupEventListeners(): void {
  // Keyboard events: Space or Enter
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      handleAdvance();
    }
  });

  // Click anywhere on the page
  document.addEventListener("click", () => {
    handleAdvance();
  });
}

function handleAdvance(): void {
  // Debounce to prevent multiple rapid clicks
  if (debounceTimer !== null) {
    return;
  }

  if (isNavigating) {
    return;
  }

  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
  }, 300);

  if (currentIndex === 0) {
    // First player: redirect to standings
    const currentLang = new URLSearchParams(window.location.search).get("lang") || "0";
    isNavigating = true;
    window.location.href = `/present/standings?tid=${tournamentId}&lang=${currentLang}`;
  } else {
    // Advance to next player (if not already at the end)
    if (currentIndex < standings.length - 1) {
      advanceToNextPlayer();
    }
  }
}

async function advanceToNextPlayer(): Promise<void> {
  const oldIndex = currentIndex;
  currentIndex++;

  const oldStanding = standings[oldIndex];
  const newStanding = standings[currentIndex];

  const display = document.getElementById("playerDisplay");
  if (!display) return;

  // Trigger exit animation on old card
  display.classList.add("is-exiting");

  // Wait for exit animation to complete
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Update DOM with new player
  // Since we're using Astro SSR, we need to manually update the DOM
  display.innerHTML = await renderNewCard(newStanding);
  display.classList.remove("is-exiting");
  display.classList.add("is-entering");

  // Trigger enter animation
  await new Promise((resolve) => setTimeout(resolve, 50));
  display.classList.add("is-animating");
}

async function renderNewCard(standing: Standing): Promise<string> {
  const getMedalColor = (rank: number): string => {
    if (rank === 1) return "gold";
    if (rank === 2) return "silver";
    if (rank === 3) return "bronze";
    return "accent";
  };

  const getRankLabel = (rank: number): string => {
    if (rank === 1) return "1st Place";
    if (rank === 2) return "2nd Place";
    if (rank === 3) return "3rd Place";
    return `${rank}th Place`;
  };

  const medal = getMedalColor(standing.rank);
  const rankLabel = getRankLabel(standing.rank);
  const photoUrl = standing.fideId
    ? `/api/player-photo/fide_${standing.fideId}.jpg`
    : undefined;

  let photoHtml = "";
  if (photoUrl) {
    photoHtml = `<img src="${photoUrl}" alt="${standing.name}" class="player-photo" />`;
  } else {
    const initials = standing.name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("");
    photoHtml = `
      <div class="photo-fallback">
        <span class="initials">${initials}</span>
      </div>
    `;
  }

  const titleHtml = standing.title
    ? `<div class="info-section" style="--delay: 0ms"><p class="title-label">${standing.title}</p></div>`
    : "";

  const federationHtml = standing.fed
    ? `<div class="info-section" style="--delay: ${standing.title ? 120 : 80}ms"><p class="federation"><span class="label">Federation:</span><span class="value">${standing.fed}</span></p></div>`
    : "";

  const clubHtml = standing.club
    ? `<div class="info-section" style="--delay: ${standing.title ? 160 : 120}ms"><p class="club"><span class="label">Club:</span><span class="value">${standing.club}</span></p></div>`
    : "";

  const delay1 = standing.title ? 40 : 0;
  const delay2 = standing.title ? 80 : 40;

  return `
    <div class="player-card is-entering">
      <div class="photo-container">
        <div class="photo-wrapper">
          ${photoHtml}
          <div class="rank-badge ${medal}">
            <span class="rank-number">${standing.rank}</span>
          </div>
        </div>
      </div>

      <div class="info-container">
        <div class="info-card">
          ${titleHtml}
          <div class="info-section" style="--delay: ${delay1}ms">
            <h1 class="player-name">${standing.name}</h1>
          </div>
          <div class="info-section" style="--delay: ${delay2}ms">
            <p class="rank-label">${rankLabel}</p>
          </div>
          ${federationHtml}
          ${clubHtml}
        </div>
      </div>
    </div>
  `;
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWinnersPresentation);
} else {
  initWinnersPresentation();
}

// Re-initialize on Astro navigation
document.addEventListener("astro:after-swap", () => {
  currentIndex = 0;
  isNavigating = false;
  initWinnersPresentation();
});
