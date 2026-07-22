// Takes an actual screenshot of the build page on akasha.cv and saves it to
// data/build-screenshot.png. Runs via GitHub Actions (needs Playwright's
// Chromium installed — see the workflow file). Anchored to visible text
// ("Mistsplitter Reforged") rather than CSS class names, since those are far
// more likely to still exist if akasha.cv changes their page layout.

import { chromium } from "playwright";
import fs from "node:fs/promises";

const BUILD_URL = "https://akasha.cv/profile/602489073?build=3522b7a268c3bb5c07a0d35bbda27828";
const ANCHOR_TEXT = "Mistsplitter Reforged";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

  await page.goto(BUILD_URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(`text=${ANCHOR_TEXT}`, { timeout: 30000 });
  await page.waitForTimeout(1500); // let icons/animations finish settling

  const clip = await page.evaluate((anchorText) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let anchorEl = null;
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.includes(anchorText)) {
        anchorEl = node.parentElement;
        break;
      }
    }
    if (!anchorEl) return null;
    const rect = anchorEl.getBoundingClientRect();
    // the weapon name sits partway down the card — pad generously above (for
    // the character portrait/name) and below (for artifacts/set bonuses)
    return {
      x: 0,
      y: Math.max(0, rect.top + window.scrollY - 260),
      width: 1280,
      height: 620,
    };
  }, ANCHOR_TEXT);

  await fs.mkdir("data", { recursive: true });

  if (clip) {
    await page.screenshot({ path: "data/build-screenshot.png", clip });
  } else {
    // fallback if the anchor text wasn't found for some reason — grab the top
    // of the page rather than failing the whole workflow
    await page.screenshot({ path: "data/build-screenshot.png", clip: { x: 0, y: 0, width: 1280, height: 900 } });
  }

  await browser.close();
  console.log("Wrote data/build-screenshot.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
