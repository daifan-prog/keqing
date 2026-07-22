// Captures GH's real build-card image from akasha.cv (the same one behind
// their own "Download"/"Open" buttons — canvas.bg-as-canvas) and saves it to
// data/build-screenshot.png.
//
// akasha.cv's own backend is sometimes intermittently flaky (observed 503s on
// some of its internal API calls even in normal interactive use) — when that
// happens the page can render a "No data found" state instead of the build
// card. Rather than treat that as fatal, this script detects it and retries
// the page load a few times with backoff. Only if every retry still fails
// does it fall back to generating a simpler card from the leaderboard API
// data directly (which has proven reliable), so the pipeline never produces
// nothing at all — but it always prefers the real akasha.cv card first.

import { chromium } from "playwright";
import fs from "node:fs/promises";

const BUILD_URL = "https://akasha.cv/profile/602489073?build=3522b7a268c3bb5c07a0d35bbda27828";
const CARD_CANVAS_SELECTOR = "canvas.bg-as-canvas";
const OUTPUT_PATH = "data/build-screenshot.png";
const MAX_ATTEMPTS = 4;

const CALCULATION_ID = "1000004200";
const VARIANT = "tf";
const TRACKED_UID = "602489073";
const LEADERBOARD_PAGE_URL = `https://akasha.cv/leaderboards/${CALCULATION_ID}/${VARIANT}`;
const LEADERBOARD_API_URL =
  `https://akasha.cv/api/leaderboards?sort=calculation.result&order=-1&size=20&page=1` +
  `&filter=&uids=&p=&fromId=&li=&variant=${VARIANT}&calculationId=${CALCULATION_ID}`;

function refinementLabel(value) {
  return `R${(value ?? 0) + 1}`;
}

function primaryArtifactSet(artifactSets) {
  if (!artifactSets) return "";
  const entries = Object.entries(artifactSets);
  if (entries.length === 0) return "";
  entries.sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
  const [name, info] = entries[0];
  return `${name} (${info.count}pc)`;
}

async function waitForCanvasToSettle(page, selector, { checks = 6, intervalMs = 800, maxWaitMs = 20000 } = {}) {
  const start = Date.now();
  let lastSignature = null;
  let stableCount = 0;

  while (Date.now() - start < maxWaitMs) {
    const signature = await page.evaluate((sel) => {
      const canvas = document.querySelector(sel);
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const w = canvas.width;
      const h = canvas.height;
      const points = [
        [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
        [Math.floor(w / 2), Math.floor(h / 2)],
        [Math.floor(w / 4), Math.floor(h / 4)],
        [Math.floor((3 * w) / 4), Math.floor((3 * h) / 4)],
      ];
      let sig = "";
      for (const [x, y] of points) {
        try {
          const data = ctx.getImageData(x, y, 1, 1).data;
          sig += `${data[0]},${data[1]},${data[2]},${data[3]}|`;
        } catch (e) {
          return null;
        }
      }
      return sig;
    }, selector);

    if (signature === null) {
      await page.waitForTimeout(intervalMs);
      continue;
    }
    if (signature === lastSignature) {
      stableCount++;
      if (stableCount >= checks) return true;
    } else {
      stableCount = 0;
    }
    lastSignature = signature;
    await page.waitForTimeout(intervalMs);
  }
  return false;
}

async function tryCaptureRealCard(page) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`Attempt ${attempt}/${MAX_ATTEMPTS}: loading build page…`);
    await page.goto(BUILD_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

    const hasRealData = await page
      .evaluate(() => {
        const bodyText = document.body.innerText || "";
        if (bodyText.includes("No data found")) return false;
        return !!document.querySelector("canvas.bg-as-canvas");
      })
      .catch(() => false);

    if (!hasRealData) {
      console.log("Build data didn't load this attempt (got \"No data found\" or missing canvas) — retrying…");
      await page.waitForTimeout(3000 * attempt); // back off a bit more each retry
      continue;
    }

    console.log("Build data loaded. Waiting for the canvas to finish drawing (polling pixel content)…");
    const settled = await waitForCanvasToSettle(page, CARD_CANVAS_SELECTOR);
    console.log(settled ? "Canvas content stabilized." : "Timed out waiting for canvas to stabilize — using it anyway.");
    await page.waitForTimeout(500);

    const canvas = page.locator(CARD_CANVAS_SELECTOR).first();
    await canvas.screenshot({ path: OUTPUT_PATH });
    console.log(`Wrote ${OUTPUT_PATH} from the real akasha.cv card (attempt ${attempt}).`);
    return true;
  }
  console.log(`Gave up after ${MAX_ATTEMPTS} attempts — build data never loaded.`);
  return false;
}

function cardHtml({ weapon, artifactSet, critRate, critDmg, atk, dmgBonus, avgDmg, cv, rank, total }) {
  const rankLine = rank && total ? `#${rank} of ${total.toLocaleString()} players` : "";
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 900px; font-family: 'Inter', sans-serif;
    background: linear-gradient(135deg, #0e0b1f 0%, #1a1530 100%);
    padding: 32px; color: #e8e3f5;
  }
  .eyebrow {
    display: flex; align-items: center; gap: 8px; font-family: 'Rajdhani', sans-serif;
    font-size: 13px; letter-spacing: 2px; color: #8b5cf6; font-weight: 700; margin-bottom: 6px;
  }
  h1 { font-family: 'Rajdhani', sans-serif; font-size: 36px; font-weight: 700; color: #f3f0fb; margin-bottom: 4px; }
  .sub { font-size: 13px; color: #9a90b8; margin-bottom: 12px; }
  .notice {
    font-size: 11px; color: #f2c14e; background: rgba(242,193,78,0.1); border: 1px solid rgba(242,193,78,0.35);
    border-radius: 8px; padding: 8px 12px; margin-bottom: 20px;
  }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .stat { background: #181330; border: 1px solid #2a2246; border-radius: 12px; padding: 14px 16px; }
  .stat.accent { background: linear-gradient(135deg,#241c3f,#2c2050); border-color: #4c3a8a; }
  .stat.wide { grid-column: span 3; }
  .label { font-size: 11px; color: #9a90b8; letter-spacing: 0.3px; margin-bottom: 4px; }
  .value { font-family: 'Rajdhani', sans-serif; font-size: 24px; font-weight: 700; color: #f3f0fb; }
  .value.wide { font-size: 18px; }
  .value.accent { color: #c9b6ff; }
  .footer { margin-top: 20px; font-size: 12px; color: #6b6289; text-align: right; }
</style></head>
<body>
  <div class="eyebrow">⚡ KEQING · MISTSPLITTER REFORGED</div>
  <h1>GH's Build</h1>
  <div class="sub">Aggravate Combo with EM buff, Avg DMG (4p TF)</div>
  <div class="notice">akasha.cv's own card couldn't load today (their backend was temporarily unavailable) — showing the same stats instead.</div>
  <div class="grid">
    <div class="stat wide"><div class="label">Weapon</div><div class="value wide">${weapon}</div></div>
    <div class="stat wide"><div class="label">Artifact Set</div><div class="value wide">${artifactSet}</div></div>
    <div class="stat"><div class="label">Crit Rate</div><div class="value">${critRate}%</div></div>
    <div class="stat"><div class="label">Crit DMG</div><div class="value">${critDmg}%</div></div>
    <div class="stat"><div class="label">CV</div><div class="value accent">${cv}</div></div>
    <div class="stat"><div class="label">ATK</div><div class="value">${atk.toLocaleString()}</div></div>
    <div class="stat"><div class="label">DMG Bonus</div><div class="value">${dmgBonus}%</div></div>
    <div class="stat accent"><div class="label">Avg DMG</div><div class="value accent">${avgDmg.toLocaleString()}</div></div>
  </div>
  <div class="footer">${rankLine} — akasha.cv</div>
</body></html>`;
}

async function captureFallbackCard(page) {
  console.log("Falling back: fetching stats via the leaderboard API and rendering our own card…");
  await page.goto(LEADERBOARD_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

  const json = await page.evaluate(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
    return res.json();
  }, LEADERBOARD_API_URL);

  const rows = json.data || [];
  let totalPlayers = null;
  if (json.totalRowsHash) {
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

  const trackedIndex = rows.findIndex((e) => e.uid === TRACKED_UID);
  const trackedEntry = trackedIndex >= 0 ? rows[trackedIndex] : rows[0];
  if (!trackedEntry) throw new Error("No leaderboard rows returned — can't build a fallback card without data.");

  const s = trackedEntry.stats || {};
  const cardData = {
    weapon: `${trackedEntry.weapon?.name || ""} ${refinementLabel(trackedEntry.weapon?.weaponInfo?.refinementLevel?.value)}`.trim(),
    artifactSet: primaryArtifactSet(trackedEntry.artifactSets),
    critRate: s.critRate ? (s.critRate.value * 100).toFixed(1) : "—",
    critDmg: s.critDamage ? (s.critDamage.value * 100).toFixed(1) : "—",
    atk: s.atk ? Math.round(s.atk.value) : 0,
    dmgBonus: s.electroDamageBonus ? (s.electroDamageBonus.value * 100).toFixed(1) : "—",
    avgDmg: trackedEntry.calculation?.result != null ? Math.round(trackedEntry.calculation.result) : 0,
    cv: trackedEntry.critValue != null ? trackedEntry.critValue.toFixed(1) : "—",
    rank: trackedIndex >= 0 ? trackedIndex + 1 : null,
    total: totalPlayers,
  };

  await page.setContent(cardHtml(cardData), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUTPUT_PATH });
  console.log(`Wrote ${OUTPUT_PATH} (fallback card).`);
}

async function main() {
  console.log("Launching browser…");
  const browser = await chromium.launch({
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 1400 },
  });

  await fs.mkdir("data", { recursive: true });

  const gotRealCard = await tryCaptureRealCard(page);
  if (!gotRealCard) {
    await captureFallbackCard(page);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Screenshot script failed:", err);
  process.exit(1);
});
