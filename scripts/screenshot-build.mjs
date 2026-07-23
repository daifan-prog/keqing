// Captures GH's Keqing build-card image and saves it to
// data/build-screenshot.png.
//
// Switched from akasha.cv to enka.network as the primary source: akasha.cv's
// profile/build page consistently failed to load its character data at all
// when run from GitHub Actions (100% failure rate across many runs, even
// with retries) — enka.network is the underlying data source akasha.cv
// itself pulls character icons from, and it's built specifically for heavy
// third-party/bot consumption (many Discord bots and apps hit its API
// constantly), so it doesn't have the same bot-protection issues. Its
// showcase page also renders the card as a plain DOM element rather than a
// canvas, which is simpler and more reliable to capture.
//
// If enka.network ever has its own issue, this still falls back to
// rendering a simple card from the leaderboard stats already fetched by
// update-leaderboard.mjs (read locally, no extra network calls, can't fail
// from a network/bot-protection issue).

import { chromium } from "playwright";
import fs from "node:fs/promises";

const ENKA_URL = "https://enka.network/u/602489073/";
const CHARACTER_NAME = "Keqing";
const OUTPUT_PATH = "data/build-screenshot.png";
const LEADERBOARD_JSON_PATH = "data/leaderboard.json";
const MAX_ATTEMPTS = 3;

async function tryCaptureEnkaCard(page) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`Attempt ${attempt}/${MAX_ATTEMPTS}: loading enka.network showcase…`);
    try {
      await page.goto(ENKA_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector('[class*="Card"]', { timeout: 20000 });
      await page.waitForTimeout(1500); // let icons/fonts finish settling

      const cardLocator = page.locator('[class*="Card"]').filter({ hasText: CHARACTER_NAME }).first();
      const count = await page.locator('[class*="Card"]').filter({ hasText: CHARACTER_NAME }).count();

      if (count === 0) {
        console.log(`No card found containing "${CHARACTER_NAME}" this attempt — retrying…`);
        await page.waitForTimeout(3000 * attempt);
        continue;
      }

      await cardLocator.screenshot({ path: OUTPUT_PATH });
      console.log(`Wrote ${OUTPUT_PATH} from enka.network (attempt ${attempt}).`);
      return true;
    } catch (err) {
      console.error(`Attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) await page.waitForTimeout(3000 * attempt);
    }
  }
  console.log(`Gave up after ${MAX_ATTEMPTS} attempts on enka.network.`);
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
  <div class="notice">Neither akasha.cv nor enka.network loaded in this run — showing the same stats instead.</div>
  <div class="grid">
    <div class="stat wide"><div class="label">Weapon</div><div class="value wide">${weapon}</div></div>
    <div class="stat wide"><div class="label">Artifact Set</div><div class="value wide">${artifactSet}</div></div>
    <div class="stat"><div class="label">Crit Rate</div><div class="value">${critRate}%</div></div>
    <div class="stat"><div class="label">Crit DMG</div><div class="value">${critDmg}%</div></div>
    <div class="stat"><div class="label">CV</div><div class="value accent">${cv}</div></div>
    <div class="stat"><div class="label">ATK</div><div class="value">${Number(atk).toLocaleString()}</div></div>
    <div class="stat"><div class="label">DMG Bonus</div><div class="value">${dmgBonus}%</div></div>
    <div class="stat accent"><div class="label">Avg DMG</div><div class="value accent">${Number(avgDmg).toLocaleString()}</div></div>
  </div>
  <div class="footer">${rankLine} — akasha.cv</div>
</body></html>`;
}

async function captureFallbackCard(page) {
  console.log("Falling back: reading already-fetched stats from data/leaderboard.json (no extra network calls)…");

  let data;
  try {
    const raw = await fs.readFile(LEADERBOARD_JSON_PATH, "utf8");
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`Couldn't read ${LEADERBOARD_JSON_PATH}: ${err.message}`);
    return false;
  }

  const build = data.build;
  if (!build) {
    console.error("data/leaderboard.json has no build data to render a fallback card from.");
    return false;
  }

  const rankRow = data.trackedRank && Array.isArray(data.top20?.rows)
    ? data.top20.rows.find((r) => r.rank === data.trackedRank)
    : null;

  const cardData = {
    weapon: build.weapon || "—",
    artifactSet: build.artifactSet || "—",
    critRate: build.critRate != null ? build.critRate : "—",
    critDmg: build.critDmg != null ? build.critDmg : "—",
    atk: build.atk || 0,
    dmgBonus: build.dmgBonus != null ? build.dmgBonus : "—",
    avgDmg: build.avgDmg || 0,
    cv: rankRow?.cv != null ? rankRow.cv : "—",
    rank: data.trackedRank || null,
    total: data.totalPlayers || null,
  };

  try {
    await page.setContent(cardHtml(cardData), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUTPUT_PATH });
    console.log(`Wrote ${OUTPUT_PATH} (fallback card, rendered from local data).`);
    return true;
  } catch (err) {
    console.error(`Rendering fallback card failed: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("Launching browser…");
  const browser = await chromium.launch({
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });

  await fs.mkdir("data", { recursive: true });

  const gotEnkaCard = await tryCaptureEnkaCard(page);
  let gotSomething = gotEnkaCard;
  if (!gotEnkaCard) {
    gotSomething = await captureFallbackCard(page);
  }

  await browser.close();

  if (!gotSomething) {
    console.log("Couldn't produce any screenshot this run — leaving the existing data/build-screenshot.png untouched.");
    return;
  }
}

main().catch((err) => {
  console.error("Screenshot script failed unexpectedly:", err);
  process.exit(1);
});
