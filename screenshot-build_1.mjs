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
//
// Important: the canvas *element* appears in the DOM well before it's
// actually finished drawing (it fills in icons/images from enka.network
// asynchronously). Waiting only for the element to be "attached" and then a
// fixed short delay can capture it mid-draw, producing a messy/incomplete
// image — especially on a cold CI run where assets load slower than during
// interactive testing. Instead, we poll the canvas's actual pixel content
// until it stops changing between checks (i.e. drawing has settled).

import { chromium } from "playwright";
import fs from "node:fs/promises";

const BUILD_URL = "https://akasha.cv/profile/602489073?build=3522b7a268c3bb5c07a0d35bbda27828";
const CARD_CANVAS_SELECTOR = "canvas.bg-as-canvas";
const OUTPUT_PATH = "data/build-screenshot.png";

async function waitForCanvasToSettle(page, selector, { checks = 6, intervalMs = 800, maxWaitMs = 20000 } = {}) {
  const start = Date.now();
  let lastSignature = null;
  let stableCount = 0;

  while (Date.now() - start < maxWaitMs) {
    const signature = await page.evaluate((sel) => {
      const canvas = document.querySelector(sel);
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
      // sample a small grid of pixels rather than hashing the whole canvas —
      // fast, and enough to detect "still drawing" vs "finished"
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
          return null; // e.g. tainted canvas — caller will fall back
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
      if (stableCount >= checks) return true; // unchanged across several checks — done drawing
    } else {
      stableCount = 0;
    }
    lastSignature = signature;
    await page.waitForTimeout(intervalMs);
  }

  return false; // timed out without stabilizing — caller decides what to do
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

  console.log("Navigating to build page…");
  await page.goto(BUILD_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

  await fs.mkdir("data", { recursive: true });

  try {
    console.log(`Waiting for ${CARD_CANVAS_SELECTOR} to be attached…`);
    const canvas = page.locator(CARD_CANVAS_SELECTOR).first();
    await canvas.waitFor({ state: "attached", timeout: 30000 });

    console.log("Waiting for the canvas to finish drawing (polling pixel content)…");
    const settled = await waitForCanvasToSettle(page, CARD_CANVAS_SELECTOR);
    console.log(settled ? "Canvas content stabilized." : "Timed out waiting for canvas to stabilize — capturing anyway.");

    // small extra buffer regardless, cheap insurance
    await page.waitForTimeout(500);

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
