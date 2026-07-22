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
  const browser = await chromium.launch();
  const page = await browser.newPage();

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

  const today = new Date().toISOString().slice(0, 10);

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
      avgDmg: trackedEntry.calculation?.result != null ? Math.round(trackedEntry.calculation.result) : null,
    };
  }

  const trackedRank = rows.findIndex((e) => e.uid === TRACKED_UID);

  const output = {
    updatedOn: today,
    fetchedAt: new Date().toISOString(),
    totalPlayers,
    trackedRank: trackedRank >= 0 ? trackedRank + 1 : null,
    build,
    top20: { updatedOn: today, rows: top20Rows },
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile("data/leaderboard.json", JSON.stringify(output, null, 2) + "\n");
  console.log("Wrote data/leaderboard.json:", JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error("update-leaderboard.mjs failed:", err);
  process.exit(1);
});
