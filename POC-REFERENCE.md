# Chess Openings Practice POC - Reference Documentation

## Overview

The Chess Openings Practice feature is a lightweight, framework-agnostic Proof of Concept (POC) integrated into the existing Astro architecture. It allows users to practice chess openings directly through their browser matching specific variations against simulated opponent responses.

## Technical Stack

1. **Astro SSR (`src/pages/practice.astro`)**
   - Renders the responsive shell.
   - Fetches available openings directly from the underlying SQLite database using `getOpenings()`.
   - Injects initial database seed natively without requiring additional client-side API hits.
2. **Vanilla JS Component (`src/components/ChessOpeningPractice.astro`)**
   - Contains exactly zero React/Vue layout dependencies, seamlessly adhering to the existing project guidelines.
   - Utilizes `cm-chessboard` for SVG-based UI rendering, board orientation, and snapping logic.
   - Utilizes `chess.js` to determine logical legality of user moves and parse SAN formatted moves from the database.
3. **Data Layer (`src/lib/db.ts`)**
   - Introduces an `openings` table leveraging `better-sqlite3`.
   - The table utilizes JSON constraints via standard `TEXT` fields to persist series of standard algebraic notation moves (SAN) representing the variations up to 15 moves.
   - Provides an API payload proxy `src/pages/api/openings.ts` to allow dynamic fetching if expanded in the future.

## Openings Database Schema

\`\`\`sql
CREATE TABLE IF NOT EXISTS openings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  variation TEXT NOT NULL DEFAULT '',
  eco TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'w',
  moves TEXT NOT NULL DEFAULT '[]', -- JSON array of SAN moves
  starting_fen TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
);
\`\`\`

## Architecture & Data Flow

When a user visits the practice page, all valid openings are pulled from SQLite and serialized into a custom script tag which is then synchronously hydrated into the board scripts.

\`\`\`mermaid
sequenceDiagram
    actor Player
    participant Server as Astro SSR (practice.astro)
    participant DB as SQLite (data/chess-results.db)
    participant UI as cm-chessboard
    participant Logic as chess.js

    Player->>Server: Access /practice
    Server->>DB: getOpenings()
    DB-->>Server: [ { id, name, variation, moves } ]
    Server-->>Player: Return HTML + Injected JSON Payload

    Player->>UI: Selects Opening Variation
    UI->>Logic: game.load(starting_fen)
    UI->>UI: setOrientation(color)
    UI->>UI: Optionally play first opponent move (if side is Black)

    Player->>UI: Drags piece (make move)
    UI->>Logic: Validate move syntactically (using temporary state)
    alt Move Matches Opening Sequence
        Logic-->>UI: Move valid & matches expected
        UI->>Player: "Correct move" sequence visually appended
        UI->>Logic: game.move(expected_move) (Execute on state)
        Note over UI: Simulate Opponent Delay (400ms)
        Logic->>UI: Execute next ply in moves array
        UI->>Player: Animated Opponent Move rendered on Board
    else Move Incorrect
        Logic-->>UI: Does not match expected Opening move
        UI-->>Player: Flashes "Incorrect move. Try again."
        UI->>UI: Returns false on validateMoveInput (Snaps piece back natively)
    end
\`\`\`

## Expected Behaviors & Contracts

- **Incorrect Moves Execution**: `cm-chessboard` utilizes the `validateMoveInput` event hook. If an attempted move isn't the correct variation index, it returns `false`, aborting the event cycle natively thus securely snapping the piece back to its previous bounds.
- **Side Evaluation**: The `color` property within `openings` table guarantees that upon selecting a layout, `board.setOrientation()` naturally turns towards the player.
- **Asymmetric Starts**: If the user is practicing an opening meant for **Black** (e.g. playing the Najdorf Sicilian), the client naturally checks `color === 'b'` and instantly simulates White's `e4` to prompt the user's defensive line start.

## Deployment Notes

- Installed packages: `chess.js` and `cm-chessboard`
- Seed Script created at: `scripts/seed-openings.ts` (Executable via `npx tsx scripts/seed-openings.ts`)
- Features isolated to Git Branch: `feature/practice-openings-poc`