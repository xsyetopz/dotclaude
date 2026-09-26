#!/usr/bin/env bash
set -euo pipefail
cat > count.mjs <<'SRC'
#!/usr/bin/env node
// Print the number of lines in each file named on the command line.
import fs from "node:fs";

const files = process.argv.slice(2);
let total = 0;
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n").length - 1;
  total += lines;
  console.log(`${lines}\t${file}`);
}
console.log(`${total}\ttotal`);
SRC
printf 'a\nb\n' > a.txt
