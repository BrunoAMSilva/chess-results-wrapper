// ─── Tournament Types ──────────────────────────────────────────────────────────

export enum TournamentType {
  Swiss = 'swiss',
  RoundRobin = 'round-robin',
  TeamSwiss = 'team-swiss',
  TeamRoundRobin = 'team-round-robin',
}

export interface TournamentInfo {
  name: string;
  round: number;
  totalRounds: number;
  date: string;
  location: string;
  type: TournamentType;
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
  tieBreak1: string;
  tieBreak2: string;
  tieBreak3: string;
}

export interface StandingsData {
  info: TournamentInfo;
  standings: Standing[];
  /** Derived women-only standings (present when sex column exists). */
  womenStandings: Standing[];
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
  created_at?: string;
  updated_at?: string;
}

export interface DbTournamentPlayer {
  tournament_id: string;
  player_id: number;
  starting_number: number;
  rating: number | null;
  club: string;
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
  rank: number;
  points: string;
  tie_break_1: string;
  tie_break_2: string;
  tie_break_3: string;
}
