import { DEFAULT_TOURNAMENT } from "./constants";
import { getIntParam } from "./request-params";
import { resolvePageLang } from "./page-lang";
import { getTournament, getPlayerTitleMap, getTournamentConfig, setTournamentConfig } from "./db";
import type { TournamentInfo, TournamentData, StandingsData } from "./types";

type CookieValue = { value: string } | undefined;
type CookieStore = {
  get: (name: string) => CookieValue;
  set: (name: string, value: string, options: Record<string, unknown>) => void;
};

/** Parse the shared tid/lang/round query params used across tournament pages. */
export function extractPageParams(url: URL, cookies: CookieStore) {
  return {
    tid: url.searchParams.get("tid") || DEFAULT_TOURNAMENT,
    lang: resolvePageLang(url, cookies),
    round: getIntParam(url.searchParams.get("round"), 1, 1, 64),
  };
}

/** Derive the page title + eyebrow from scraped tournament info. */
export function resolveTournamentDisplay(
  info: TournamentInfo | undefined,
  siteTitle: string,
): { sectionTitle: string; eyebrow: string | undefined } {
  return {
    sectionTitle: info?.currentLabel || info?.name || siteTitle,
    eyebrow: info?.currentLabel ? info.name : undefined,
  };
}

/** Best-available tournament name: scraped → DB → empty. */
export function resolveTournamentName(
  data: TournamentData | StandingsData | undefined,
  tid: string,
): string {
  if (data?.info?.name) return data.info.name;
  try { return getTournament(tid)?.name || ""; } catch { return ""; }
}

/** Load the player title map for a tournament, or {} on failure. */
export function loadPlayerTitleMap(tid: string): Record<string, string> {
  try { return getPlayerTitleMap(tid); } catch { return {}; }
}

export type SponsorConfig = {
  sponsorImage: string;
  sponsorAlt: string;
  /** Query suffix (leading `&`) to preserve sponsor across presenter links. */
  switchSuffix: string;
  /** Hidden form fields that round-trip sponsorAlt through the config panel. */
  hiddenFields: Array<{ name: string; value: string }>;
};

/**
 * Resolve presenter sponsor image/alt from URL params with DB fallback.
 * URL params take precedence and auto-persist to the tournament config.
 */
export function resolveSponsorConfig(url: URL, tid: string): SponsorConfig {
  const sponsorParam = url.searchParams.get("sponsor")?.trim() || "";
  const sponsorAltParam = url.searchParams.get("sponsorAlt")?.trim() || "";

  let sponsorImage = sponsorParam;
  let sponsorAlt = sponsorAltParam || "Sponsor";

  if (sponsorParam) {
    setTournamentConfig(tid, "sponsor_image", sponsorParam);
    if (sponsorAltParam) setTournamentConfig(tid, "sponsor_alt", sponsorAltParam);
  } else {
    const savedImage = getTournamentConfig(tid, "sponsor_image");
    if (savedImage) {
      sponsorImage = savedImage;
      sponsorAlt = getTournamentConfig(tid, "sponsor_alt") || "Sponsor";
    }
  }

  const switchParams = new URLSearchParams();
  if (sponsorImage) switchParams.set("sponsor", sponsorImage);
  if (sponsorAlt && sponsorAlt !== "Sponsor") switchParams.set("sponsorAlt", sponsorAlt);
  const switchSuffix = switchParams.toString() ? `&${switchParams.toString()}` : "";

  const hiddenFields: Array<{ name: string; value: string }> = [];
  if (sponsorAlt && sponsorAlt !== "Sponsor") {
    hiddenFields.push({ name: "sponsorAlt", value: sponsorAlt });
  }

  return { sponsorImage, sponsorAlt, switchSuffix, hiddenFields };
}

/**
 * Presenter pages disable auto-refresh once the tournament end date has passed.
 * Missing/undated tournaments are treated as live.
 */
export function isTournamentLive(dateStr?: string): boolean {
  if (!dateStr) return true;
  const tournamentDate = new Date(dateStr.replace(/\//g, "-"));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return tournamentDate >= today;
}
