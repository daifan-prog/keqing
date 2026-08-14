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

  try {
    console.log("Estimating total players via binary search on the leaderboard API…");
    const SEARCH_SIZE = 20;

    async function hasDataAtPage(pg) {
      const url = LEADERBOARD_API_URL.replace("page=1", `page=${pg}`);
      const result = await page.evaluate(async (u) => {
        try {
          const res = await fetch(u);
          if (!res.ok) return { ok: false, status: res.status };
          const j = await res.json();
          return { ok: true, count: Array.isArray(j.data) ? j.data.length : 0 };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }, url);
      return result;
    }

    // first check: does page=1 even work? (sanity check — main fetch already succeeded)
    const page1Check = await hasDataAtPage(1);
    console.log(`  Page 1 check: ${JSON.stringify(page1Check)}`);

    if (!page1Check.ok || page1Check.count === 0) {
      console.log("  Binary search aborted — even page 1 failed or returned empty.");
    } else {
      let lo = 1;
      let hi = 15000;

      const hiCheck = await hasDataAtPage(hi);
      console.log(`  Page ${hi} check: ${JSON.stringify(hiCheck)}`);

      if (hiCheck.ok && hiCheck.count > 0) {
        hi = 50000;
      }

      let iterations = 0;
      while (lo < hi && iterations < 20) {
        iterations++;
        const mid = Math.floor((lo + hi) / 2);
        const midResult = await hasDataAtPage(mid);
        if (iterations <= 3) console.log(`  Iteration ${iterations}: page ${mid} → ${JSON.stringify(midResult)}`);
        if (midResult.ok && midResult.count > 0) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      console.log(`  Search converged: lo=${lo}, hi=${hi} after ${iterations} iterations`);

      const lastPageWithData = lo - 1;
      if (lastPageWithData >= 1) {
        const lastResult = await hasDataAtPage(lastPageWithData);
        console.log(`  Last page (${lastPageWithData}): ${JSON.stringify(lastResult)}`);
        const lastPageCount = lastResult.ok ? lastResult.count : 0;
        totalPlayers = (lastPageWithData - 1) * SEARCH_SIZE + lastPageCount;
        console.log(`Binary search result: ${totalPlayers} total players`);
      }
    }
  } catch (err) {
    console.error("Binary search estimation failed (non-fatal):", err.message);
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
  const finalRank = trackedRank >= 0 ? trackedRank + 1 : null;

  // read whatever's already committed once, reused for both the top20 history
  // and the check-in log below — both are maintained here now instead of in
  // each browser's local storage, so every device sees the same thing
  let previousHistory = [];
  let previousCheckins = [{ date: "2026-02-02", rank: 1, total: null, note: "First reached Rank 1" }];
  let previousTotalPlayers = null;
  try {
    const existingRaw = await fs.readFile("data/leaderboard.json", "utf8");
    const existing = JSON.parse(existingRaw);
    if (Array.isArray(existing.top20History)) previousHistory = existing.top20History;
    if (Array.isArray(existing.checkins) && existing.checkins.length > 0) previousCheckins = existing.checkins;
    if (existing.totalPlayers != null) previousTotalPlayers = existing.totalPlayers;
  } catch (err) {
    console.log("No existing data/leaderboard.json to read from (first run) — starting fresh.");
  }

  // if the fresh fetch failed to get a total (API returned 403 or similar),
  // carry forward the last known good value rather than overwriting it with null
  if (totalPlayers == null && previousTotalPlayers != null) {
    console.log(`getCollectionSize returned null — carrying forward previous totalPlayers: ${previousTotalPlayers}`);
    totalPlayers = previousTotalPlayers;
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

  // maintain today's check-in entry: insert if missing, update in place if
  // rank/total have changed since an earlier run today (e.g. the morning and
  // evening scheduled runs), leave untouched if nothing's different
  let checkins = previousCheckins;
  if (finalRank != null) {
    const existingIdx = previousCheckins.findIndex((c) => c.date === today);
    const freshEntry = { date: today, rank: finalRank, total: totalPlayers || null, note: "Auto-synced from akasha.cv" };
    if (existingIdx === -1) {
      checkins = previousCheckins.concat([freshEntry]).sort((a, b) => (a.date < b.date ? -1 : 1));
      console.log(`Added new check-in for ${today}: rank=${finalRank}, total=${totalPlayers}`);
    } else {
      const existing = previousCheckins[existingIdx];
      if (existing.rank === freshEntry.rank && existing.total === freshEntry.total) {
        console.log(`Check-in for ${today} unchanged — leaving as-is.`);
      } else {
        checkins = previousCheckins.slice();
        checkins[existingIdx] = { ...existing, rank: freshEntry.rank, total: freshEntry.total };
        console.log(`Updated existing check-in for ${today}: rank=${finalRank}, total=${totalPlayers}`);
      }
    }
  }

  const output = {
    updatedOn: today,
    fetchedAt: new Date().toISOString(),
    totalPlayers,
    trackedRank: finalRank,
    build,
    top20: todaysSnapshot,
    top20History,
    checkins,
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile("data/leaderboard.json", JSON.stringify(output, null, 2) + "\n");
  console.log(
    `Wrote data/leaderboard.json — updatedOn=${output.updatedOn}, rank=${output.trackedRank}, ` +
    `totalPlayers=${output.totalPlayers}, historyEntries=${top20History.length}, checkinEntries=${checkins.length}`
  );
}

main().catch((err) => {
  console.error("update-leaderboard.mjs failed:", err);
  process.exit(1);
});
