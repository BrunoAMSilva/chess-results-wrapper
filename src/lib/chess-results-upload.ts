import { BASE_URL } from './constants';
import {
  getTournamentConfig,
  getRefereeResults,
  getPlayerUidMap,
  logUploadResult,
  getUploadLog,
} from './db';
import { ensurePlayerUids } from './scraper';
import type { Pairing, TeamPairing } from './types';

// ── Result code mapping: our format → chess-results.com upload code ──

const UPLOAD_CODE_MAP: Record<string, string> = {
  '1-0': '1',
  '0-1': '0',
  '½-½': 'x',
  '+:-': '+',
  '-:+': '-',
  '-:-': 'D',
};

export function mapResultToUploadCode(result: string): string {
  return UPLOAD_CODE_MAP[result] ?? '';
}

// ── XML payload builder ──

/**
 * Build the XML payload for chess-results.com result upload.
 * Uses `{`/`}` instead of `<`/`>` as required by the API
 * (chess-results.com rejects `<`/`>` as a security measure).
 */
export function buildUploadXml(
  sid: string,
  tournament: string,
  round: number,
  uid: number,
  resultCode: string,
): string {
  return (
    '{?xml version="1.0" encoding="UTF-8"?}' +
    '{Pairing}' +
    `{data sid="${sid}" Tournament="${tournament}" Round="${round}" Uid="${uid}" Result="${resultCode}" /}` +
    '{/Pairing}'
  );
}

// ── Response parsing ──

export interface UploadResponse {
  status: string;
  statusMsg: string;
}

/**
 * Parse the XML response from chess-results.com.
 * Response format: `<UpdatePairing><data status="OK" statusMsg="..."/></UpdatePairing>`
 */
export function parseUploadResponse(xml: string): UploadResponse {
  const statusMatch = xml.match(/status="([^"]*)"/);
  const msgMatch = xml.match(/statusMsg="([^"]*)"/);
  return {
    status: statusMatch?.[1] ?? 'ERROR',
    statusMsg: msgMatch?.[1] ?? 'Unknown response',
  };
}

// ── HTTP POST to chess-results.com ──

export async function postResultToChessResults(
  xmlPayload: string,
): Promise<UploadResponse> {
  const url = `${BASE_URL}/xml.aspx?key1=UpdResult`;
  const body = new URLSearchParams({ xml: xmlPayload });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    return { status: 'ERROR', statusMsg: `HTTP ${response.status}` };
  }

  const responseXml = await response.text();
  return parseUploadResponse(responseXml);
}

// ── Bulk upload orchestrator ──

export interface UploadResultEntry {
  table_number: number;
  uid: number;
  resultCode: string;
  status: string;
  statusMsg: string;
}

export interface UploadRoundParams {
  tournamentId: string;
  round: number;
  /** Pairings for the round (individual boards, including team board pairings) */
  allPairings: Pairing[];
  teamPairings?: TeamPairing[];
}

/**
 * Upload all submitted referee results for a round to chess-results.com.
 *
 * Flow:
 * 1. Validate SID is configured
 * 2. Ensure UIDs are cached
 * 3. Build table→startingNumber map from pairings (white player)
 * 4. For each referee result: look up UID, convert result, POST, log status
 *
 * Skips tables that already have status=OK in the upload log.
 */
export async function uploadRoundResults(
  params: UploadRoundParams,
): Promise<UploadResultEntry[]> {
  const { tournamentId, round, allPairings, teamPairings } = params;

  const sid = getTournamentConfig(tournamentId, 'sid');
  if (!sid) {
    throw new Error('Tournament SID not configured');
  }

  const uidMap = await ensurePlayerUids(tournamentId);

  // Build table → white player starting_number from pairings
  const tableWhiteMap: Record<number, number> = {};
  if (teamPairings && teamPairings.length > 0) {
    for (const tm of teamPairings) {
      for (const b of tm.boards) {
        tableWhiteMap[b.table] = b.white.number;
      }
    }
  } else {
    for (const p of allPairings) {
      tableWhiteMap[p.table] = p.white.number;
    }
  }

  const refereeResults = getRefereeResults(tournamentId, round);
  if (refereeResults.length === 0) {
    return [];
  }

  // Check existing upload log to skip already-uploaded results
  const existingLog = getUploadLog(tournamentId, round);
  const alreadyUploaded = new Set(
    existingLog.filter(l => l.status === 'OK').map(l => l.table_number),
  );

  const results: UploadResultEntry[] = [];

  for (const ref of refereeResults) {
    const { table_number, result } = ref;

    // Skip tables already successfully uploaded
    if (alreadyUploaded.has(table_number)) {
      const existing = existingLog.find(l => l.table_number === table_number)!;
      results.push({
        table_number,
        uid: existing.uid,
        resultCode: existing.result_code,
        status: 'OK',
        statusMsg: 'Already uploaded',
      });
      continue;
    }

    const whiteStartingNumber = tableWhiteMap[table_number];
    if (!whiteStartingNumber) {
      const entry: UploadResultEntry = {
        table_number,
        uid: 0,
        resultCode: '',
        status: 'ERROR',
        statusMsg: 'No pairing found for table',
      };
      logUploadResult(tournamentId, round, table_number, 0, '', 'ERROR', entry.statusMsg);
      results.push(entry);
      continue;
    }

    const uid = uidMap[whiteStartingNumber];
    if (!uid) {
      const entry: UploadResultEntry = {
        table_number,
        uid: 0,
        resultCode: '',
        status: 'ERROR',
        statusMsg: `No UID found for starting number ${whiteStartingNumber}`,
      };
      logUploadResult(tournamentId, round, table_number, 0, '', 'ERROR', entry.statusMsg);
      results.push(entry);
      continue;
    }

    const resultCode = mapResultToUploadCode(result);
    if (!resultCode) {
      const entry: UploadResultEntry = {
        table_number,
        uid,
        resultCode: '',
        status: 'ERROR',
        statusMsg: `Unknown result format: ${result}`,
      };
      logUploadResult(tournamentId, round, table_number, uid, '', 'ERROR', entry.statusMsg);
      results.push(entry);
      continue;
    }

    const xml = buildUploadXml(sid, tournamentId, round, uid, resultCode);
    const response = await postResultToChessResults(xml);

    logUploadResult(
      tournamentId,
      round,
      table_number,
      uid,
      resultCode,
      response.status,
      response.statusMsg,
    );

    results.push({
      table_number,
      uid,
      resultCode,
      status: response.status,
      statusMsg: response.statusMsg,
    });
  }

  return results;
}
