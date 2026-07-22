// Captures the actual shareable build-card image from akasha.cv and saves it
// to data/build-screenshot.png. Runs via GitHub Actions (needs Playwright's
// Chromium installed — see the workflow file).
//
// This targets canvas.bg-as-canvas directly — a purpose-built, off-screen
// canvas the page renders automatically (the same one behind its own
// "Download"/"Open" build-card export buttons) — rather than cropping a
// screenshot of the live page layout. This gives a pixel-perfect copy of the
// same clean card you'd get from using those buttons yourself, without
// needing to click through a download flow.

import { chromium } from "playwright";
import fs from "node:fs/promises";

const BUILD_URL = "https://akasha.cv/profile/602489073?build=3522b7a268c3bb5c07a0d35bbda27828";
const CARD_CANVAS_SELECTOR = "canvas.bg-as-canvas";
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

  try {
    console.log(`Waiting for ${CARD_CANVAS_SELECTOR} to render…`);
    const canvas = page.locator(CARD_CANVAS_SELECTOR).first();
    await canvas.waitFor({ state: "attached", timeout: 30000 });
    await page.waitForTimeout(1500); // let the card finish drawing (icons, radar chart, etc.)

    const box = await canvas.boundingBox();
    console.log("Canvas bounding box:", box);

    await canvas.screenshot({ path: OUTPUT_PATH });
    console.log(`Wrote ${OUTPUT_PATH} from the card canvas.`);
  } catch (err) {
    console.error(`Couldn't capture the card canvas: ${err.message}`);
    console.error("Falling back to a plain top-of-page screenshot instead of failing entirely.");
    await page.screenshot({ path: OUTPUT_PATH, clip: { x: 0, y: 0, width: 1280, height: 900 } });
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Screenshot script failed:", err);
  process.exit(1);
});
