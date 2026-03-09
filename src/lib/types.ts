// ─── Tournament Types ──────────────────────────────────────────────────────────

export enum TournamentType {
  Swiss = 'swiss',
  RoundRobin = 'round-robin',
  TeamSwiss = 'team-swiss',
  TeamRoundRobin = 'team-round-robin',
}

export interface LinkedTournament {
  id: string;
  name: string;
}

export interface TournamentInfo {
  name: string;
  round: number;
  totalRounds: number;
  date: string;
  location: string;
  type: TournamentType;
  linkedTournaments?: LinkedTournament[];
  /** Short label for this tournament from the event's "Tournament selection" row. */
  currentLabel?: string;
  /** "Last update" timestamp from chess-results.com (ISO format). */
  lastUpdated?: string;
}

// ─── Player / Standing ────────────────────────────────────────────────────────

export type Sex = 'M' | 'F' | '';

export interface Standing {
  rank: number;
  startingNumber: number;
  name: string;
  fed: string;
  rating: string;
  club: string;
  points: string;
  sex: Sex;
  fideId: string;
  tieBreak1: string;
  tieBreak2: string;
  tieBreak3: string;
  tieBreak4: string;
  tieBreak5: string;
  tieBreak6: string;
}

export interface StandingsData {
  info: TournamentInfo;
  standings: Standing[];
  /** Derived women-only standings (present when sex column exists). */
  womenStandings: Standing[];
  /** Present only for team tournaments — team-level rankings. */
  teamStandings?: TeamStanding[];
}

// ─── Team Standings ───────────────────────────────────────────────────────────

/** A single team's standing entry, parsed from team-composition pages (art=1). */
export interface TeamStanding {
  rank: number;
  name: string;
  /** Average rating of the team. */
  ratingAvg: number;
  /** Captain name, if available. */
  captain: string;
  /** Tie-break values parsed from the header (e.g. TB1, TB2). */
  tieBreak1: string;
  tieBreak2: string;
  /** Individual player rows within this team. */
  players: TeamPlayerEntry[];
}

/** A player row within a team-composition standings table. */
export interface TeamPlayerEntry {
  board: number;
  name: string;
  rating: string;
  fed: string;
  fideId: string;
  points: string;
  games: string;
  ratingAvg: string;
}

// ─── Pairings ─────────────────────────────────────────────────────────────────

export interface PlayerRef {
  name: string;
  number: number;
}

export interface Pairing {
  table: number;
  white: PlayerRef;
  black: PlayerRef | null;
  unpairedLabel?: string;
  result: string;
}

export interface TeamPairing {
  table: number;
  whiteTeam: string;
  blackTeam: string;
  boards: Pairing[];
  result: string;
}

export interface TournamentData {
  info: TournamentInfo;
  pairings: Pairing[];
  /** Present only for team tournaments. */
  teamPairings?: TeamPairing[];
}

// ─── Database Models ──────────────────────────────────────────────────────────

export interface DbTournament {
  id: string;
  name: string;
  type: TournamentType;
  total_rounds: number;
  date: string;
  location: string;
  event_label: string;
  linked_tournaments: string;
  last_updated: string;
  created_at: string;
  updated_at: string;
}

export interface DbPlayer {
  id?: number;
  name: string;
  fide_id: string | null;
  federation: string;
  sex: Sex;
  club: string;
  rating: number | null;
  birth_year: number | null;
  national_id: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DbTournamentPlayer {
  tournament_id: string;
  player_id: number;
  starting_number: number;
  rating: number | null;
  club: string;
  national_rating: number | null;
  performance_rating: number | null;
  rating_change: string | null;
}

export interface DbResult {
  id?: number;
  tournament_id: string;
  round: number;
  table_number: number;
  white_player_id: number | null;
  black_player_id: number | null;
  white_team: string | null;
  black_team: string | null;
  result: string;
}

export interface DbStanding {
  tournament_id: string;
  player_id: number;
  type: string;
  rank: number;
  points: string;
  tie_break_1: string;
  tie_break_2: string;
  tie_break_3: string;
}

export interface DbPlayerTournamentHistory {
  tournament_id: string;
  tournament_name: string;
  event_label: string;
  date: string;
  location: string;
  type: TournamentType;
  total_rounds: number;
  updated_at: string;
  rank: number | null;
  points: string | null;
  tie_break_1: string | null;
  tie_break_2: string | null;
  tie_break_3: string | null;
  tie_break_4: string | null;
  tie_break_5: string | null;
  tie_break_6: string | null;
  starting_number: number;
  tournament_rating: number | null;
  tournament_club: string;
  national_rating: number | null;
  performance_rating: number | null;
  rating_change: string | null;
}

export interface DbPlayerResultEntry {
  tournament_id: string;
  white_player_id: number | null;
  black_player_id: number | null;
  result: string;
}

// ─── Player Card (art=9) ──────────────────────────────────────────────────────

export interface PlayerCardData {
  name: string;
  federation: string;
  fideId: string;
  club: string;
  birthYear: number | null;
  nationalId: string;
  rating: number | null;
  nationalRating: number | null;
  performanceRating: number | null;
  ratingChange: string;
  startingNumber: number;
  rank: number;
  points: string;
}
