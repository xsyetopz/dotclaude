// The model and effort rules for a subagent. Pure functions: the module
// reads the agent file and the spawn input, and passes them here.

import { SUBAGENT_EFFORTS } from "./_budget.mjs";

/** `model` and `effort` from the front matter of an agent file's text. */
export function parseDefinition(text) {
  const head = text.split(/^---\s*$/m)[1] ?? "";
  return {
    model: /^model:\s*(\S+)\s*$/m.exec(head)?.[1] ?? "",
    effort: /^effort:\s*(\S+)\s*$/m.exec(head)?.[1] ?? "",
  };
}

/** The model that an agent file fixes, or "" for `inherit` or no model. */
export const pinnedModel = (def) =>
  def?.model && def.model !== "inherit" ? def.model : "";

// The bare aliases name the current model of each family.
const ALIASES = {
  opus: "opus-5-5",
  sonnet: "sonnet-5-5",
  haiku: "haiku-4-5",
  fable: "fable-5-1",
};

/**
 * A key for a model name: `claude-sonnet-5-5`, `sonnet-5-5[1m]`, and a name
 * with a date suffix give `sonnet-5-5`. An alias gives its current model.
 */
export function modelKey(name) {
  const key = String(name ?? "")
    .toLowerCase()
    .replace(/\[.*\]$/, "")
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/\./g, "-");
  return ALIASES[key] ?? key;
}

const code = (list) => list.map((x) => `\`${x}\``).join(", ");
const allowedModels = () => code(Object.keys(SUBAGENT_EFFORTS));

/**
 * The reason to deny a spawn, or undefined.
 * `askedModel` is the `model` of the call, `parentModel` is the model of the
 * caller, `pinned` is the model of the agent file, and `effort` is the effort
 * that the agent runs with. A call with no `model` runs on `pinned`, and
 * without that on `parentModel`.
 */
export function spawnDenial({ askedModel, parentModel, pinned, effort }) {
  if (askedModel && pinned && modelKey(askedModel) !== modelKey(pinned))
    return `This agent is fixed to the model \`${pinned}\`, and the call asked for \`${askedModel}\`. Omit \`model\`, or pick the agent whose model you need.`;
  const model = pinned || askedModel || parentModel;
  // The spawn names no model and the engine gave none: nothing to check.
  if (!model) return undefined;
  const key = modelKey(model);
  const efforts = SUBAGENT_EFFORTS[key];
  if (!efforts)
    return `A subagent cannot run on \`${model}\`. The allowed models are ${allowedModels()}. Pick an agent that fixes one of them.`;
  if (effort && !efforts.includes(effort))
    return efforts.length
      ? `The effort \`${effort}\` is not allowed for \`${key}\`. The allowed efforts are ${code(efforts)}.`
      : `\`${key}\` takes no effort, and the effort is \`${effort}\`. Remove the effort.`;
  return undefined;
}
