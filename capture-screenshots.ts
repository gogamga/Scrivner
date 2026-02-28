/**
 * capture-screenshots.ts — Automated screenshot capture for all 11 workflow journeys.
 * Captures: full canvas, zoomed regions, hover tooltips, node selections, phase containers.
 * Usage: bun capture-screenshots.ts
 */
import puppeteer from "puppeteer";
import { mkdir } from "node:fs/promises";

const BASE_URL = "http://localhost:8091";
const OUT_DIR = import.meta.dir + "/screenshots";
const VIEWPORT = { width: 1440, height: 900 };

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle0" });
  await delay(1500); // let React render + auto-center

  // Get journey list from sidebar
  const journeyCards = await page.$$(".journey-card");
  const journeyCount = journeyCards.length;
  console.log(`Found ${journeyCount} journeys`);

  // ── Pass 1: Full canvas screenshot for each journey ──────────────
  for (let i = 0; i < journeyCount; i++) {
    // Re-query cards (DOM may shift after clicks)
    const cards = await page.$$(".journey-card");
    const card = cards[i];
    if (!card) continue;

    const journeyName = await card.$eval(
      ".journey-card-name",
      (el) => el.textContent || ""
    );
    const slug = journeyName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    console.log(`\n── Journey ${i + 1}/${journeyCount}: ${journeyName} ──`);

    await card.click();
    await delay(800); // wait for render + auto-center

    // Full page screenshot
    await page.screenshot({
      path: `${OUT_DIR}/${String(i + 1).padStart(2, "0")}-${slug}-full.png`,
      fullPage: false,
    });
    console.log(`  [x] Full canvas captured`);

    // ── Capture phase containers visibility ──
    const phaseContainers = await page.$$(".phase-container");
    console.log(`  [i] Phase containers: ${phaseContainers.length}`);

    // ── Capture zoomed-out view (fit all) ──
    await page.keyboard.down("Shift");
    await page.keyboard.press("!");
    await page.keyboard.up("Shift");
    await delay(500);
    await page.screenshot({
      path: `${OUT_DIR}/${String(i + 1).padStart(2, "0")}-${slug}-fit.png`,
      fullPage: false,
    });
    console.log(`  [x] Fit-to-view captured`);

    // Reset zoom
    await page.keyboard.down("Meta");
    await page.keyboard.press("0");
    await page.keyboard.up("Meta");
    await delay(300);

    // ── Hover first 3 nodes to capture tooltips ──
    const nodes = await page.$$(".step-node");
    for (let n = 0; n < Math.min(3, nodes.length); n++) {
      const node = nodes[n];
      if (!node) continue;
      // Dispatch mouseenter directly for React compatibility in headless mode
      await page.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('mouseenter', {
          bubbles: false, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
        }));
        el.dispatchEvent(new MouseEvent('mouseover', {
          bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
        }));
      }, node);
      await delay(500); // wait for 400ms tooltip delay + render
      await page.screenshot({
        path: `${OUT_DIR}/${String(i + 1).padStart(2, "0")}-${slug}-hover-${n}.png`,
        fullPage: false,
      });
      // Dismiss tooltip via mouseleave
      await page.evaluate((el) => {
        el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      }, node);
      await delay(200);
    }
    console.log(`  [x] Hover tooltips captured`);

    // ── Click first node to show annotation panel ──
    if (nodes.length > 0) {
      await nodes[0].click();
      await delay(400);
      await page.screenshot({
        path: `${OUT_DIR}/${String(i + 1).padStart(2, "0")}-${slug}-panel.png`,
        fullPage: false,
      });
      console.log(`  [x] Annotation panel captured`);

      // Close panel by clicking canvas background
      await page.click(".canvas");
      await delay(300);
    }

    // ── Click a decision node if exists ──
    const decisionNodes = await page.$$('.step-node[data-type="decision"]');
    if (decisionNodes.length > 0) {
      await decisionNodes[0].click();
      await delay(400);
      await page.screenshot({
        path: `${OUT_DIR}/${String(i + 1).padStart(2, "0")}-${slug}-decision.png`,
        fullPage: false,
      });
      console.log(`  [x] Decision node selection captured`);
      await page.click(".canvas");
      await delay(300);
    }

    // ── Check start/end nodes ──
    const startNode = await page.$(".step-node--start");
    const endNodes = await page.$$(".step-node--end");
    console.log(
      `  [i] Start node: ${startNode ? "yes" : "NO"}, End nodes: ${endNodes.length}`
    );
  }

  // ── Pass 2: Dense area zoomed captures ──────────────────────────
  console.log("\n── Dense area analysis ──");
  // Go back to first journey
  const firstCard = await page.$(".journey-card");
  if (firstCard) {
    await firstCard.click();
    await delay(800);

    // Zoom in to 150% for dense area check
    for (let z = 0; z < 4; z++) {
      await page.keyboard.down("Meta");
      await page.keyboard.press("=");
      await page.keyboard.up("Meta");
      await delay(150);
    }
    await delay(300);
    await page.screenshot({
      path: `${OUT_DIR}/dense-zoomed-150.png`,
      fullPage: false,
    });
    console.log(`  [x] 150% zoom captured`);

    // Zoom to 200%
    for (let z = 0; z < 4; z++) {
      await page.keyboard.down("Meta");
      await page.keyboard.press("=");
      await page.keyboard.up("Meta");
      await delay(150);
    }
    await delay(300);
    await page.screenshot({
      path: `${OUT_DIR}/dense-zoomed-200.png`,
      fullPage: false,
    });
    console.log(`  [x] 200% zoom captured`);

    // Reset
    await page.keyboard.down("Meta");
    await page.keyboard.press("0");
    await page.keyboard.up("Meta");
    await delay(300);
  }

  await browser.close();

  // Count total screenshots
  const glob = new Bun.Glob("*.png");
  const files = Array.from(glob.scanSync(OUT_DIR));
  console.log(`\n✓ Done! ${files.length} screenshots saved to ${OUT_DIR}`);
}

main().catch(console.error);
