// Quick sanity check — parse every grid_coverage csv and report rows + locations.
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("grid_coverage");
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".csv"));

const total = { rows: 0, parsed: 0, skipped: 0 };
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  const lines = text.split(/\r?\n/).slice(1).filter((l) => l.trim());
  let parsed = 0;
  let skipped = 0;
  const locations = new Set();
  for (const line of lines) {
    const match = line.trim().match(/^"([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"$/);
    if (match) {
      parsed++;
      if (match[3]) locations.add(match[3]);
    } else {
      skipped++;
      if (skipped <= 2) console.log(`  ${f} skipped: ${line.slice(0, 100)}`);
    }
  }
  total.rows += lines.length;
  total.parsed += parsed;
  total.skipped += skipped;
  console.log(`${f.padEnd(28)} rows=${lines.length} parsed=${parsed} skipped=${skipped} locations=[${[...locations].join("|")}]`);
}
console.log(`\nTOTAL rows=${total.rows} parsed=${total.parsed} skipped=${total.skipped}`);
