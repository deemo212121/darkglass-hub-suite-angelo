/**
 * Builds src/lib/teamUpdates.json — every update (non-merge commit) by
 * Angelo, Jhon and John Oliver, each read from their own repo, for the
 * AHS Server Status & Updates page.
 *
 *   node scripts/team-updates.cjs          (fetches the three remotes first)
 *   node scripts/team-updates.cjs --no-fetch
 *
 * Needs the remotes: origin (Angelo), rulonajhon (Jhon), janeyyy16 (John Oliver).
 *
 * Run on every push, after the work is committed, then commit the list on
 * its own as "AHS Updates list refreshed" (left out of the list below) so
 * the push's own update is on it:
 *   node scripts/team-updates.cjs && git add src/lib/teamUpdates.json
 *   git commit -m "AHS Updates list refreshed" && git push origin main
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src/lib/teamUpdates.json");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

// The initial import of the app — not anyone's update.
const IMPORT_COMMIT = "69d6747a";

const PEOPLE = [
  { key: "angelo", name: "Angelo", remote: "origin", authors: ["mendozaangelo321123@gmail.com", "deemo212121@github.com"] },
  { key: "jhon", name: "Jhon", remote: "rulonajhon", authors: ["rulonajhon"] },
  { key: "johnoliver", name: "John Oliver", remote: "janeyyy16", authors: ["johnoliverblanciadegamo@gmail.com"] },
];

if (!process.argv.includes("--no-fetch")) {
  for (const p of PEOPLE) {
    try { git("fetch", "--quiet", p.remote); } catch (e) { console.warn(`Couldn't fetch ${p.remote} — using what's already here.`); }
  }
}

const SEP = "\u001e", END = "\u001f";
const people = PEOPLE.map((p) => {
  // Angelo's updates come from this local main — it has the commit being pushed before origin does.
  const ref = p.remote === "origin" ? "main" : `${p.remote}/main`;
  const raw = git("log", "--no-merges", ...p.authors.map((a) => `--author=${a}`), `--format=%h${SEP}%aI${SEP}%B${END}`, "--shortstat", ref, `^${IMPORT_COMMIT}`);
  const updates = [];
  for (const chunk of raw.split(END)) {
    const [hashPart, date, message] = chunk.split(SEP);
    if (!message) continue;
    // --shortstat lands at the start of the next chunk; take the hash after it.
    const lines = hashPart.trim().split("\n");
    const hash = lines[lines.length - 1].trim();
    const text = message.replace(/\n*Co-Authored-By:.*$/gim, "").trim();
    if (!text || /^Merge (branch|remote|pull|rulonajhon|.*into)/i.test(text)) continue;
    updates.push({ hash, date, text });
  }
  // Files changed per update — from the stat lines that follow each commit.
  const stats = git("log", "--no-merges", ...p.authors.map((a) => `--author=${a}`), "--format=@%h", "--shortstat", ref, `^${IMPORT_COMMIT}`);
  const files = {};
  let cur = null;
  for (const l of stats.split("\n")) {
    if (l.startsWith("@")) cur = l.slice(1).trim();
    else if (cur && /files? changed/.test(l)) files[cur] = Number(l.trim().split(" ")[0]) || 0;
  }
  for (const u of updates) u.files = files[u.hash] ?? 0;
  return { key: p.key, name: p.name, updates };
});

// Counted by who actually made the change, not who merged it: Jhon brings
// everyone's work into his repo by re-committing it under his name ("Merge
// angelo's branch: …", "Pull deemo212121/…", "sync: upstream fixes …") —
// those are Angelo's / John Oliver's changes, already counted from their own
// repos, so they're left out here, along with checkpoints before a pull.
const BRINGS_IN = /^(\w+:\s*)?(merge|pull|integrate|sync)\b|^sync:|(from|with) upstream|from angelo/i;
const SOMEONE_ELSE = /angelo|janeyyy|deemo212121|upstream|john oliver/i;
const isMergeOrSync = (text) => {
  const first = text.split("\n")[0];
  return /^checkpoint before pulling/i.test(first) || (BRINGS_IN.test(first) && SOMEONE_ELSE.test(first));
};
// This script's own commit of the refreshed list isn't an update either.
const LIST_REFRESH = /^AHS Updates list refreshed/i;
for (const p of people) p.updates = p.updates.filter((u) => !isMergeOrSync(u.text) && !LIST_REFRESH.test(u.text));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), people }));
for (const p of people) console.log(`${p.name}: ${p.updates.length} updates, ${p.updates.reduce((n, u) => n + u.files, 0)} file changes`);
console.log(`Wrote ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
