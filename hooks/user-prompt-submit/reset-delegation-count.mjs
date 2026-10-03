// UserPromptSubmit: a message of the user starts a new task, so the count of
// read calls that note-delegation.mjs keeps starts again. A generated
// message, such as a task notification, does not reset it.

import { userTyped } from "../lib/_core.mjs";
import { setReads } from "../lib/_delegation.mjs";

export default async (io, data) => {
  if (userTyped(data.prompt)) await setReads(io, data, 0);
  return null;
};
