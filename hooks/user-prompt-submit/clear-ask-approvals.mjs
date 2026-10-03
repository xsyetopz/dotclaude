// UserPromptSubmit: a message of the user ends the current task, so an ask
// kind that the user approved (for example test edits) is asked again. A
// generated message, such as a task notification, is not a message of the
// user and clears nothing.

import { userTyped } from "../lib/_core.mjs";
import { clearKindApprovals } from "../lib/_verdicts.mjs";

export default async (io, data) => {
  if (userTyped(data.prompt)) await clearKindApprovals(io, data);
  return null;
};
