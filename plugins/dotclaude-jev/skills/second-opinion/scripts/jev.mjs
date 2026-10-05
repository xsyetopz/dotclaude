#!/usr/bin/env bun
// A second opinion from TypeSafe Jev, a decision model that answers typed questions about a state:
// yes or no, one option from a set, or a level on a scale.
// The verbs follow the `jev` CLI by pedramamini (MIT).
// The code is our own.
//
//   bun jev.mjs yes  "<question>" [--state <file | - | text>]
//   bun jev.mjs pick "<question>" <option>[=<description>]... [--state ...]
//   bun jev.mjs rate "<question>" <level>... [--state ...]
//   bun jev.mjs ask  [--state ...] < request.json

import { existsSync, readFileSync } from "node:fs";

const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const TRIES = 4;
const TIMEOUT_MS = 30000;
// Under this confidence, the TypeSafe docs treat an answer as uncertain.
const LOW_CONFIDENCE = 0.5;
const VERBS = {
  yes: "noul",
  noul: "noul",
  pick: "choice",
  choice: "choice",
  rate: "score",
  score: "score",
  ask: "ask",
};
const USAGE =
  'Use `jev.mjs yes|pick|rate|ask "<question>" [options or levels] [--state <file | - | text>]`.';

export class UsageError extends Error {}

/** The verb, the words after it, and the `--state` value. */
export function parseArgs(argv) {
  const [verb, ...rest] = argv;
  const kind = VERBS[String(verb).toLowerCase()];
  if (!kind)
    throw new UsageError(`The verb \`${verb ?? ""}\` is not known. ${USAGE}`);
  let state;
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--state") state = rest[++i] ?? "";
    else if (rest[i].startsWith("--state=")) state = rest[i].slice(8);
    else words.push(rest[i]);
  }
  return { kind, words, state };
}

/** The state text: stdin for `-`, a file when the path exists, else the text itself. */
export function readState(arg, stdin) {
  switch (arg) {
    case undefined:
      return "";
    case "-":
      return stdin();
    default:
      return existsSync(arg) ? readFileSync(arg, "utf8") : arg;
  }
}

/** The request body for the parsed arguments. */
export function buildBody({ kind, words, state }, stdin) {
  if (kind === "ask") {
    if (state === "-")
      throw new UsageError(
        "`ask` reads the questions from stdin, so give `--state` a file or text.",
      );
    let req;
    try {
      req = JSON.parse(stdin());
    } catch {
      throw new UsageError(
        "`ask` needs a JSON object of questions on stdin, as in the TypeSafe API.",
      );
    }
    const questions = req?.questions ?? req;
    const text =
      state === undefined ? (req?.state ?? "") : readState(state, stdin);
    return { state: text, model: req?.model ?? MODEL, questions };
  }
  const [question, ...items] = words;
  if (!question) throw new UsageError(`Give the question. ${USAGE}`);
  const q = { type: kind, instructions: question };
  switch (kind) {
    case "choice":
      if (items.length < 2 || items.length > 255)
        throw new UsageError(
          "`pick` needs 2 to 255 options, each as `key` or `key=description`.",
        );
      q.criteria = Object.fromEntries(
        items.map((item) => {
          const at = item.indexOf("=");
          return at > 0
            ? [item.slice(0, at), item.slice(at + 1)]
            : [item, null];
        }),
      );
      break;
    case "score":
      if (items.length < 2 || items.length > 10)
        throw new UsageError(
          "`rate` needs 2 to 10 levels, from the lowest to the highest.",
        );
      q.criteria = items;
      break;
  }
  return { state: readState(state, stdin), model: MODEL, questions: { q } };
}

const n = (x) => Number(x).toFixed(2);

/** The answer as short text for Claude. */
export function format(kind, answers) {
  if (kind === "ask") return JSON.stringify(answers, null, 2);
  const a = answers.q;
  if (kind === "noul") {
    const unsure = Math.abs(a.noul - 0.5) < 0.2;
    return `P(yes) = ${n(a.noul)}${unsure ? "\nThis is near 0.5, so Jev is not sure. Treat it as a weak signal." : ""}`;
  }
  const head =
    kind === "choice"
      ? `${a.choice} (confidence ${n(a.confidence)})`
      : `score ${n(a.score)} on levels 0 to ${Object.keys(a.legend).length - 1} (confidence ${n(a.confidence)})`;
  const rows = Object.entries(a.probabilities)
    .sort((x, y) => y[1] - x[1])
    .map(
      ([k, p]) => `  ${n(p)} ${kind === "score" ? `${k} ${a.legend[k]}` : k}`,
    );
  const low =
    a.confidence < LOW_CONFIDENCE
      ? ["Confidence is low, so treat this answer as a weak signal."]
      : [];
  return [head, ...rows, ...low].join("\n");
}

/** POST the body, with a retry and backoff on 429 and 529. */
export async function call(
  body,
  key,
  { fetchFn = fetch, sleep = Bun.sleep } = {},
) {
  for (let i = 0; ; i++) {
    const res = await fetchFn(API, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 529) && i < TRIES - 1) {
      await sleep(1000 * 2 ** i);
      continue;
    }
    const why =
      res.status === 401
        ? "The key in `TYPESAFE_API_KEY` is not valid."
        : await res.text();
    throw new Error(`TypeSafe API ${res.status}: ${why}`);
  }
}

if (import.meta.main) {
  const key = process.env.TYPESAFE_API_KEY;
  try {
    if (!key)
      throw new UsageError(
        "`TYPESAFE_API_KEY` is not set. Get a key at https://console.typesafe.ai and export it before Claude Code starts.",
      );
    const args = parseArgs(process.argv.slice(2));
    const stdin = () => readFileSync(0, "utf8");
    const res = await call(buildBody(args, stdin), key);
    console.log(format(args.kind, res.answers));
  } catch (err) {
    console.error(err.message);
    process.exit(err instanceof UsageError ? 2 : 1);
  }
}
