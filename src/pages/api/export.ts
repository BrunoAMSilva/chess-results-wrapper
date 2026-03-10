import type { APIRoute } from "astro";
import { scrapePairings, scrapeStandings } from "../../lib/scraper";
import { getIntParam, getLangParam } from "../../lib/request-params";

function csvEscape(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const escaped = raw.replace(/"/g, '""');
  return /[",\n]/.test(raw) ? `"${escaped}"` : escaped;
}

function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export const GET: APIRoute = async ({ url }) => {
  const tid = url.searchParams.get("tid");
  const type = url.searchParams.get("type") || "standings";
  const format = url.searchParams.get("format") || "csv";
  const lang = getLangParam(url.searchParams.get("lang"), 1);
  const round = getIntParam(url.searchParams.get("round"), 1, 1, 64);

  if (!tid) {
    return new Response(JSON.stringify({ error: "Missing tid parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (type !== "standings" && type !== "pairings") {
    return new Response(JSON.stringify({ error: "Invalid type parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (format !== "csv" && format !== "json") {
    return new Response(JSON.stringify({ error: "Invalid format parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    if (type === "standings") {
      const data = await scrapeStandings(tid, lang);
      const filename = `standings-${tid}.${format}`;

      if (format === "json") {
        return new Response(JSON.stringify(data, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename=\"${filename}\"`,
          },
        });
      }

      const headers = [
        "rank",
        "startingNumber",
        "name",
        "federation",
        "rating",
        "club",
        "points",
        "sex",
        "fideId",
        "tieBreak1",
        "tieBreak2",
        "tieBreak3",
        "tieBreak4",
        "tieBreak5",
        "tieBreak6",
      ];
      const rows = data.standings.map((s) => [
        s.rank,
        s.startingNumber,
        s.name,
        s.fed,
        s.rating,
        s.club,
        s.points,
        s.sex,
        s.fideId,
        s.tieBreak1,
        s.tieBreak2,
        s.tieBreak3,
        s.tieBreak4,
        s.tieBreak5,
        s.tieBreak6,
      ]);
      const body = toCsv(headers, rows);

      return new Response(body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"${filename}\"`,
        },
      });
    }

    const data = await scrapePairings(tid, round, lang);
    const filename = `pairings-${tid}-r${round}.${format}`;

    if (format === "json") {
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"${filename}\"`,
        },
      });
    }

    const headers = [
      "round",
      "table",
      "whiteName",
      "whiteNo",
      "blackName",
      "blackNo",
      "result",
      "unpairedLabel",
    ];

    const rows = data.pairings.map((p) => [
      round,
      p.table,
      p.white.name,
      p.white.number,
      p.black?.name || "",
      p.black?.number || "",
      p.result,
      p.unpairedLabel || "",
    ]);

    const body = toCsv(headers, rows);

    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to export";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
