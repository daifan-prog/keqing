// Fetches the Keqing (Mistsplitter Reforged, 4p TF) leaderboard from akasha.cv's
// own JSON API and writes the top 20 + GH's build stats + total player count
// to data/leaderboard.json. Runs daily via GitHub Actions (see
// .github/workflows/update-leaderboard.yml).
//
// This uses a real Playwright browser (not a bare Node fetch) to make the API
// calls FROM WITHIN an actual page context. A plain server-side fetch from
// GitHub's runner IPs gets blocked with a 403 by akasha.cv's bot protection —
// routing the request through a real browser session (same technique the
// screenshot script already uses) gets past that.

import { chromium } from "playwright";
import fs from "node:fs/promises";

const CALCULATION_ID = "1000004200";
const VARIANT = "tf";
const TRACKED_UID = "602489073"; // GH

const LEADERBOARD_PAGE_URL = `https://akasha.cv/leaderboards/${CALCULATION_ID}/${VARIANT}`;
const LEADERBOARD_API_URL =
  `https://akasha.cv/api/leaderboards?sort=calculation.result&order=-1&size=20&page=1` +
  `&filter=&uids=&p=&fromId=&li=&variant=${VARIANT}&calculationId=${CALCULATION_ID}`;

function refinementLabel(value) {
  // akasha reports refinement as a 0-indexed value (0 = R1 ... 4 = R5)
  return `R${(value ?? 0) + 1}`;
}

// matches the app's own todayIso() — "updatedOn" here needs to agree with the
// app's calendar-day boundaries, or the auto-synced check-in/history dates
// won't line up with what the app considers "today"
function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

function primaryArtifactSet(artifactSets) {
  if (!artifactSets) return "";
  const entries = Object.entries(artifactSets);
  if (entries.length === 0) return "";
  // pick the set with the highest piece count (the "real" 4pc set, ignoring
  // a mismatched 1pc/2pc off-piece some builds run)
  entries.sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
  const [name, info] = entries[0];
  return `${name} (${info.count}pc)`;
}

async function main() {
  console.log("Launching browser…");
  const browser = await chromium.launch({
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  console.log("Establishing a real browser session on akasha.cv…");
  await page.goto(LEADERBOARD_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

  console.log("Fetching leaderboard API from within the browser context…");
  const json = await page.evaluate(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
    return res.json();
  }, LEADERBOARD_API_URL);

  const rows = json.data || [];
  console.log(`Got ${rows.length} rows.`);

  let totalPlayers = null;
  if (json.totalRowsHash) {
    console.log("Fetching total player count…");
    try {
      const sizeJson = await page.evaluate(async (hash) => {
        const res = await fetch(`https://akasha.cv/api/getCollectionSize/?variant=charactersLb&hash=${hash}`);
        if (!res.ok) throw new Error(`getCollectionSize failed: ${res.status}`);
        return res.json();
      }, json.totalRowsHash);
      totalPlayers = sizeJson?.totalRows ?? null;
    } catch (err) {
      console.error("Couldn't fetch total player count (non-fatal):", err.message);
    }
  }

  await browser.close();

  const top20Rows = rows.slice(0, 20).map((entry, i) => ({
    rank: i + 1,
    nickname: entry.owner?.nickname || "",
    avgDmg: entry.calculation?.result != null ? Math.round(entry.calculation.result) : null,
    cv: entry.critValue != null ? Number(entry.critValue.toFixed(1)) : null,
  }));

  const today = todayIso();

  const trackedEntry = rows.find((e) => e.uid === TRACKED_UID) || rows[0];
  let build = null;
  if (trackedEntry) {
    const s = trackedEntry.stats || {};
    build = {
      weapon: `${trackedEntry.weapon?.name || ""} ${refinementLabel(trackedEntry.weapon?.weaponInfo?.refinementLevel?.value)}`.trim(),
      artifactSet: primaryArtifactSet(trackedEntry.artifactSets),
      critRate: s.critRate ? Number((s.critRate.value * 100).toFixed(1)) : null,
      critDmg: s.critDamage ? Number((s.critDamage.value * 100).toFixed(1)) : null,
      atk: s.atk ? Math.round(s.atk.value) : null,
      dmgBonus: s.electroDamageBonus ? Number((s.electroDamageBonus.value * 100).toFixed(1)) : null,
      elementalMastery: s.elementalMastery ? Math.round(s.elementalMastery.value) : null,
      avgDmg: trackedEntry.calculation?.result != null ? Math.round(trackedEntry.calculation.result) : null,
    };
  }

  const trackedRank = rows.findIndex((e) => e.uid === TRACKED_UID);

  // maintain a rolling history of top20 snapshots, committed to the repo so
  // every device sees the same history — read whatever's already there
  // (from previous runs) rather than relying on each browser to track it
  // locally. Only add a NEW entry when the top 20 has actually changed since
  // the most recent one — otherwise every day would add an identical entry
  // even when nothing moved, bloating the history for no reason.
  let previousHistory = [];
  try {
    const existingRaw = await fs.readFile("data/leaderboard.json", "utf8");
    const existing = JSON.parse(existingRaw);
    if (Array.isArray(existing.top20History)) previousHistory = existing.top20History;
  } catch (err) {
    console.log("No existing data/leaderboard.json to read history from (first run) — starting fresh.");
  }

  function rowsContentEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  const todaysSnapshot = { updatedOn: today, rows: top20Rows };
  const mostRecentPrevious = previousHistory
    .slice()
    .sort((a, b) => (a.updatedOn < b.updatedOn ? 1 : -1))[0];
  const unchanged = mostRecentPrevious && rowsContentEqual(mostRecentPrevious.rows, top20Rows);

  const MAX_HISTORY_ENTRIES = 200;
  let top20History;
  if (unchanged) {
    console.log(`Top 20 unchanged since ${mostRecentPrevious.updatedOn} — not adding a new history entry.`);
    top20History = previousHistory;
  } else {
    top20History = previousHistory
      .filter((h) => h.updatedOn !== today)
      .concat([todaysSnapshot])
      .sort((a, b) => (a.updatedOn < b.updatedOn ? 1 : -1))
      .slice(0, MAX_HISTORY_ENTRIES);
  }

  const output = {
    updatedOn: today,
    fetchedAt: new Date().toISOString(),
    totalPlayers,
    trackedRank: trackedRank >= 0 ? trackedRank + 1 : null,
    build,
    top20: todaysSnapshot,
    top20History,
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile("data/leaderboard.json", JSON.stringify(output, null, 2) + "\n");
  console.log(
    `Wrote data/leaderboard.json — updatedOn=${output.updatedOn}, rank=${output.trackedRank}, ` +
    `totalPlayers=${output.totalPlayers}, historyEntries=${top20History.length}`
  );
}

main().catch((err) => {
  console.error("update-leaderboard.mjs failed:", err);
  process.exit(1);
});
