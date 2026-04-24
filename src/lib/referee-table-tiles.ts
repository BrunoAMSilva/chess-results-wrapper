export type RefereeTileResultType =
  | "white-win"
  | "black-win"
  | "draw"
  | "forfeit-white"
  | "forfeit-black"
  | "forfeit-both";

export type RefereeResultRow = {
  table_number: number;
  result: string;
};

export type RefereeSubmittedTableState = {
  result: string;
  type: RefereeTileResultType;
};

const RESULT_DISPLAY: Record<string, string> = {
  "+:-": "1-0F",
  "-:+": "0-1F",
  "-:-": "0-0F",
};

export function formatRefereeTableLabel(table: number, isTeamTournament: boolean): string {
  if (!isTeamTournament) {
    return String(table);
  }

  const match = Math.floor(table / 100);
  const board = table % 100;
  return `${match}.${board}`;
}

export function refereeResultToTileType(result: string): RefereeTileResultType {
  if (result === "+:-") return "forfeit-white";
  if (result === "-:+") return "forfeit-black";
  if (result === "-:-") return "forfeit-both";
  if (result === "1-0") return "white-win";
  if (result === "0-1") return "black-win";
  return "draw";
}

export function refereeResultDisplayLabel(result: string): string {
  return RESULT_DISPLAY[result] ?? result;
}

export function buildRefereeSubmittedTableMap(
  results: ReadonlyArray<RefereeResultRow>,
): Map<number, RefereeSubmittedTableState> {
  const submittedTables = new Map<number, RefereeSubmittedTableState>();

  for (const result of results) {
    submittedTables.set(result.table_number, {
      result: result.result,
      type: refereeResultToTileType(result.result),
    });
  }

  return submittedTables;
}
