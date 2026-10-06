// Clause 18, known defects: the note text.
// A prompt hook in hooks/hooks.json checks the last message on Stop.

import fs from "node:fs";
import path from "node:path";
import { clause } from "../terms.mjs";

const NOTE = path.join(
  import.meta.dirname,
  "..",
  "..",
  "templates",
  "context",
  "known-defects.md",
);

/** The clause 18 note for the context of an agent. */
export const knownDefectsClause = () =>
  clause(
    "known-defects",
    `<known_defects>\n${fs.readFileSync(NOTE, "utf8").trim()}\n</known_defects>`,
  );
