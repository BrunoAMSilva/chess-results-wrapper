import {
  buildSelectedPlayerProfileHref,
  parseSelectedPlayerIdentity,
  playerIdentityMatches,
  SELECTED_PLAYER_STORAGE_KEY,
  serializeSelectedPlayerIdentity,
  type SelectedPlayerIdentity,
} from "../lib/player-identity";

declare global {
  interface Window {
    __selectedPlayerUiInitialized?: boolean;
    __selectedPlayerLang?: number;
  }
}

const SELECTED_PLAYER_CHANGE_EVENT = "selected-player-change";

function getCurrentLang(): number {
  const documentLang = Number.parseInt(document.documentElement.dataset.appLang || "", 10);
  if (Number.isFinite(documentLang) && documentLang > 0) return documentLang;

  const windowLang = window.__selectedPlayerLang;
  return Number.isFinite(windowLang) && windowLang ? windowLang : 1;
}

export function readSelectedPlayer(): SelectedPlayerIdentity | null {
  try {
    return parseSelectedPlayerIdentity(localStorage.getItem(SELECTED_PLAYER_STORAGE_KEY));
  } catch {
    return null;
  }
}

function dispatchSelectedPlayerChange() {
  window.dispatchEvent(new CustomEvent(SELECTED_PLAYER_CHANGE_EVENT));
}

function setSelectedPlayer(identity: SelectedPlayerIdentity) {
  try {
    localStorage.setItem(
      SELECTED_PLAYER_STORAGE_KEY,
      serializeSelectedPlayerIdentity({
        name: identity.name,
        federation: identity.federation,
      }),
    );
  } catch {
    return;
  }

  dispatchSelectedPlayerChange();
}

function clearSelectedPlayer() {
  try {
    localStorage.removeItem(SELECTED_PLAYER_STORAGE_KEY);
  } catch {
    return;
  }

  dispatchSelectedPlayerChange();
}

function updateProfileNav(selected: SelectedPlayerIdentity | null) {
  const links = document.querySelectorAll<HTMLAnchorElement>("[data-profile-nav]");
  const lang = getCurrentLang();

  links.forEach((link) => {
    if (!selected) {
      link.hidden = true;
      link.removeAttribute("href");
      return;
    }

    link.hidden = false;
    link.href = buildSelectedPlayerProfileHref(selected, lang);
  });
}

function updateIdentityControls(selected: SelectedPlayerIdentity | null) {
  const controls = document.querySelectorAll<HTMLElement>("[data-selected-player-control]");

  controls.forEach((control) => {
    const name = control.dataset.playerName || "";
    const federation = control.dataset.playerFederation || "";
    const isSelected = playerIdentityMatches(selected, { name, federation });

    const setButton = control.querySelector<HTMLElement>("[data-selected-player-set]");
    const clearButton = control.querySelector<HTMLElement>("[data-selected-player-clear]");
    const status = control.querySelector<HTMLElement>("[data-selected-player-status]");

    if (setButton) {
      setButton.toggleAttribute("hidden", isSelected);
      setButton.setAttribute("aria-pressed", isSelected ? "true" : "false");
    }

    if (clearButton) {
      clearButton.toggleAttribute("hidden", !isSelected);
    }

    if (status) {
      const selectedLabel = status.dataset.selectedLabel || "";
      const idleLabel = status.dataset.idleLabel || "";
      status.textContent = isSelected ? selectedLabel : idleLabel;
    }

    control.classList.toggle("is-selected-player-control", isSelected);
  });
}

function updateStandingsHighlights(selected: SelectedPlayerIdentity | null) {
  const entries = document.querySelectorAll<HTMLElement>("[data-selected-player-entry]");

  entries.forEach((entry) => {
    const name = entry.dataset.playerName || "";
    const federation = entry.dataset.playerFederation || "";
    entry.classList.toggle(
      "is-selected-player",
      playerIdentityMatches(selected, { name, federation }),
    );
  });
}

function updatePairingsHighlights(selected: SelectedPlayerIdentity | null) {
  const cards = document.querySelectorAll<HTMLElement>("[data-selected-player-card]");

  cards.forEach((card) => {
    let hasSelectedSlot = false;

    const slots = card.querySelectorAll<HTMLElement>("[data-selected-player-slot]");
    slots.forEach((slot) => {
      const name = slot.dataset.playerName || "";
      const federation = slot.dataset.playerFederation || "";
      const matches = playerIdentityMatches(selected, { name, federation });
      slot.classList.toggle("is-selected-player-slot", matches);
      hasSelectedSlot ||= matches;
    });

    card.classList.toggle("is-selected-player-card", hasSelectedSlot);
  });
}

function syncSelectedPlayerUi() {
  const selected = readSelectedPlayer();
  updateProfileNav(selected);
  updateIdentityControls(selected);
  updateStandingsHighlights(selected);
  updatePairingsHighlights(selected);
}

function handleDocumentClick(event: Event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const setButton = target.closest("[data-selected-player-set]");
  if (setButton) {
    const control = setButton.closest<HTMLElement>("[data-selected-player-control]");
    if (!control) return;

    const name = control.dataset.playerName || "";
    const federation = control.dataset.playerFederation || "";
    if (!name.trim()) return;

    setSelectedPlayer({ name, federation });
    return;
  }

  const clearButton = target.closest("[data-selected-player-clear]");
  if (clearButton) {
    clearSelectedPlayer();
  }
}

export function initSelectedPlayerUi(lang: number) {
  window.__selectedPlayerLang = lang;
  document.documentElement.dataset.appLang = String(lang);

  if (!window.__selectedPlayerUiInitialized) {
    document.addEventListener("click", handleDocumentClick);
    window.addEventListener(SELECTED_PLAYER_CHANGE_EVENT, syncSelectedPlayerUi);
    document.addEventListener("astro:after-swap", syncSelectedPlayerUi);
    window.__selectedPlayerUiInitialized = true;
  }

  syncSelectedPlayerUi();
}