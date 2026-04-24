import { describe, expect, it } from "vitest";

import {
  buildRefereeSubmittedTableMap,
  formatRefereeTableLabel,
  refereeResultDisplayLabel,
  refereeResultToTileType,
} from "../../src/lib/referee-table-tiles";

describe("referee table tile helpers", () => {
  it("formats individual and team table labels", () => {
    expect(formatRefereeTableLabel(7, false)).toBe("7");
    expect(formatRefereeTableLabel(304, true)).toBe("3.4");
  });

  it("maps result strings to the correct tile variants", () => {
    expect(refereeResultToTileType("1-0")).toBe("white-win");
    expect(refereeResultToTileType("0-1")).toBe("black-win");
    expect(refereeResultToTileType("0.5-0.5")).toBe("draw");
    expect(refereeResultToTileType("+:-")).toBe("forfeit-white");
    expect(refereeResultToTileType("-:+")).toBe("forfeit-black");
    expect(refereeResultToTileType("-:-")).toBe("forfeit-both");
  });

  it("formats saved result labels for table tiles", () => {
    expect(refereeResultDisplayLabel("1-0")).toBe("1-0");
    expect(refereeResultDisplayLabel("+:-")).toBe("1-0F");
    expect(refereeResultDisplayLabel("-:+")).toBe("0-1F");
    expect(refereeResultDisplayLabel("-:-")).toBe("0-0F");
  });

  it("builds a table-state map that preserves both result and tile variant", () => {
    const submittedTables = buildRefereeSubmittedTableMap([
      { table_number: 1, result: "1-0" },
      { table_number: 2, result: "-:-" },
    ]);

    expect(submittedTables.get(1)).toEqual({
      result: "1-0",
      type: "white-win",
    });
    expect(submittedTables.get(2)).toEqual({
      result: "-:-",
      type: "forfeit-both",
    });
  });
});
