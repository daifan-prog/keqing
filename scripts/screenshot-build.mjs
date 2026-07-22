// Takes an actual screenshot of the build page on akasha.cv and saves it to
// data/build-screenshot.png. Runs via GitHub Actions (needs Playwright's
// Chromium installed — see the workflow file). Anchored to visible text
// ("Mistsplitter Reforged") rather than CSS class names, since those are far
// more likely to still exist if akasha.cv changes their page layout.
//
// Important: this does NOT wait for "networkidle" — akasha.cv fires
// recurring analytics beacons in the background that can prevent the network
// from ever going fully idle, which would make Playwright time out before a
// screenshot is ever taken. Instead we wait for the actual content
// (the weapon name) to appear, which is a much more reliable signal.

import { chromium } from "playwright";
import fs from "node:fs/promises";

const BUILD_URL = "https://akasha.cv/profile/602489073?build=3522b7a268c3bb5c07a0d35bbda27828";
const ANCHOR_TEXT = "Mistsplitter Reforged";
const OUTPUT_PATH = "data/build-screenshot.png";

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

  console.log("Navigating to build page…");
  await page.goto(BUILD_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

  await fs.mkdir("data", { recursive: true });

  let anchorFound = false;
  try {
    console.log(`Waiting for "${ANCHOR_TEXT}" to render…`);
    await page.waitForSelector(`text=${ANCHOR_TEXT}`, { timeout: 30000 });
    anchorFound = true;
    await page.waitForTimeout(1500); // let icons/animations finish settling
  } catch (err) {
    console.error(`Anchor text didn't appear in time: ${err.message}`);
    console.error("Falling back to a plain top-of-page screenshot instead of failing entirely.");
  }

  if (anchorFound) {
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
      // the weapon name sits partway down the card — pad generously above
      // (for the character portrait/name) and below (for artifacts/set bonuses)
      return {
        x: 0,
        y: Math.max(0, rect.top + window.scrollY - 260),
        width: 1280,
        height: 620,
      };
    }, ANCHOR_TEXT);

    if (clip) {
      console.log("Anchor found, capturing clipped screenshot:", clip);
      await page.screenshot({ path: OUTPUT_PATH, clip });
    } else {
      console.log("Anchor text appeared but element lookup failed — using fallback region.");
      await page.screenshot({ path: OUTPUT_PATH, clip: { x: 0, y: 0, width: 1280, height: 900 } });
    }
  } else {
    // Content never rendered in time (slow load, site change, etc.) — still
    // save *something* rather than leaving no file at all, so the workflow
    // doesn't silently produce nothing.
    await page.screenshot({ path: OUTPUT_PATH, clip: { x: 0, y: 0, width: 1280, height: 900 } });
  }

  await browser.close();
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Screenshot script failed:", err);
  process.exit(1);
});
