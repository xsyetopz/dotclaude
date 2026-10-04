// Rows from groups of parts. Each part is `{priority, text}`.

import { SEP, width } from "./paint.mjs";

/**
 * Pack each group's parts into rows no wider than `columns`. A group starts
 * a new row, but a group of one part leaves its row open to the next group,
 * so that no row holds only the model. A part that does not fit goes to the
 * next row.
 */
function pack(groups, columns) {
  const rows = [];
  let row = "";
  let open = false;
  for (const group of groups) {
    if (!group.length) continue;
    if (row && !open) {
      rows.push(row);
      row = "";
    }
    for (const { text } of group) {
      if (row && width(row + SEP + text) <= columns) row += SEP + text;
      else {
        if (row) rows.push(row);
        row = text;
      }
    }
    open = group.length === 1;
  }
  if (row) rows.push(row);
  return rows;
}

/**
 * The packed rows, at most `maxRows`. Past it, the lowest-priority part goes
 * first, one at a time. It removes parts from `groups`.
 */
export function fitRows(groups, columns, maxRows) {
  let rows = pack(groups, columns);
  while (rows.length > maxRows && groups.flat().length > 1) {
    const lowest = groups
      .flat()
      .reduce((a, b) => (b.priority < a.priority ? b : a));
    for (const group of groups)
      if (group.includes(lowest)) group.splice(group.indexOf(lowest), 1);
    rows = pack(groups, columns);
  }
  return rows;
}
