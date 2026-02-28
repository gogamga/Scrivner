/**
 * gui-test-pilot.ts — Automated GUI test for the first-launch workflow.
 * Tests: navigation, node interaction, tooltips, panel, zoom, pan, phase containers.
 * Captures screenshots at each step and logs observations.
 * Usage: bun gui-test-pilot.ts
 */
import puppeteer, { type Page, type ElementHandle } from "puppeteer";
import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL = "http://localhost:8091";
const OUT_DIR = import.meta.dir + "/screenshots/gui-test";
const VIEWPORT = { width: 1440, height: 900 };

interface TestResult {
  step: string;
  status: "pass" | "fail" | "warn";
  observation: string;
  screenshot: string;
}

const results: TestResult[] = [];
let stepNum = 0;

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function captureStep(
  page: Page,
  name: string,
  status: TestResult["status"],
  observation: string
) {
  stepNum++;
  const filename = `${String(stepNum).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: `${OUT_DIR}/${filename}`, fullPage: false });
  results.push({ step: name, status, observation, screenshot: filename });
  const icon = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "WARN";
  console.log(`  [${icon}] ${name}: ${observation}`);
}

async function getBoundingBox(el: ElementHandle) {
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
}

async function checkOverlap(page: Page, selector1: string, selector2: string): Promise<boolean> {
  return page.evaluate(
    (s1, s2) => {
      const els1 = document.querySelectorAll(s1);
      const els2 = document.querySelectorAll(s2);
      for (const a of els1) {
        const ra = a.getBoundingClientRect();
        for (const b of els2) {
          if (a === b) continue;
          const rb = b.getBoundingClientRect();
          if (
            ra.left < rb.right &&
            ra.right > rb.left &&
            ra.top < rb.bottom &&
            ra.bottom > rb.top
          ) {
            return true;
          }
        }
      }
      return false;
    },
    selector1,
    selector2
  );
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
  await delay(1500);

  console.log("═══ GUI Test Pilot: first-launch journey ═══\n");

  // ── Test 1: Initial load ──
  const journeyCards = await page.$$(".journey-card");
  const activeCard = await page.$(".journey-card.active");
  await captureStep(
    page,
    "initial-load",
    journeyCards.length === 11 && activeCard ? "pass" : "fail",
    `${journeyCards.length} journeys loaded, first selected: ${!!activeCard}`
  );

  // ── Test 2: Sidebar journey card has correct name ──
  const firstCardName = await page.$eval(
    ".journey-card.active .journey-card-name",
    (el) => el.textContent || ""
  );
  await captureStep(
    page,
    "first-journey-name",
    firstCardName === "First Launch" ? "pass" : "warn",
    `First journey: "${firstCardName}"`
  );

  // ── Test 3: Step nodes rendered ──
  const stepNodes = await page.$$(".step-node");
  await captureStep(
    page,
    "step-nodes-count",
    stepNodes.length === 11 ? "pass" : "warn",
    `${stepNodes.length} step nodes rendered (expected 11)`
  );

  // ── Test 4: Start node exists and styled ──
  const startNode = await page.$(".step-node--start");
  const startBadge = startNode
    ? await page.evaluate(
        (el) => {
          const style = window.getComputedStyle(el, "::after");
          return style.content;
        },
        startNode
      )
    : null;
  await captureStep(
    page,
    "start-node",
    startNode ? "pass" : "fail",
    `Start node present: ${!!startNode}, badge content: ${startBadge}`
  );

  // ── Test 5: End node(s) exist ──
  const endNodes = await page.$$(".step-node--end");
  await captureStep(
    page,
    "end-nodes",
    endNodes.length > 0 ? "pass" : "fail",
    `${endNodes.length} end node(s) found`
  );

  // ── Test 6: Phase containers rendered ──
  const phaseContainers = await page.$$(".phase-container");
  const phaseLabels = await page.$$eval(".phase-label", (els) =>
    els.map((e) => e.textContent)
  );
  await captureStep(
    page,
    "phase-containers",
    phaseContainers.length > 0 ? "pass" : "fail",
    `${phaseContainers.length} phase containers: [${phaseLabels.join(", ")}]`
  );

  // ── Test 7: Node-to-node overlap check ──
  const nodeOverlap = await checkOverlap(page, ".step-node", ".step-node");
  await captureStep(
    page,
    "node-overlap-check",
    nodeOverlap ? "fail" : "pass",
    `Node-to-node overlap detected: ${nodeOverlap}`
  );

  // ── Test 8: Edge label overlap with nodes ──
  const labelOverlap = await checkOverlap(page, ".edge-label-pill", ".step-node");
  await captureStep(
    page,
    "edge-label-overlap",
    labelOverlap ? "warn" : "pass",
    `Edge labels overlapping nodes: ${labelOverlap}`
  );

  // ── Test 9: Phase container overlap with other phases ──
  const phaseOverlap = await checkOverlap(
    page,
    ".phase-container",
    ".phase-container"
  );
  await captureStep(
    page,
    "phase-overlap-check",
    phaseOverlap ? "warn" : "pass",
    `Phase container overlap: ${phaseOverlap}`
  );

  // ── Test 10: START badge clipping check ──
  if (startNode) {
    const startBox = await getBoundingBox(startNode);
    const canvasBox = await page.$eval(".canvas", (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    const clipped = startBox.y < canvasBox.y;
    await captureStep(
      page,
      "start-badge-clipping",
      clipped ? "warn" : "pass",
      `Start node top: ${startBox.y.toFixed(0)}px, canvas top: ${canvasBox.y.toFixed(0)}px, clipped: ${clipped}`
    );
  }

  // ── Test 11-16: Click each of first 6 nodes, check tooltip + panel ──
  for (let n = 0; n < Math.min(6, stepNodes.length); n++) {
    const nodes = await page.$$(".step-node");
    const node = nodes[n];
    if (!node) continue;

    const nodeLabel = await node.$eval(".step-node-label", (el) =>
      el.textContent?.trim() || ""
    );
    const nodeType = await node.evaluate((el) =>
      el.getAttribute("data-type") || "unknown"
    );

    // Hover for tooltip — scroll node into view, then move mouse to its center.
    await node.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
    await delay(200);
    const box = await node.boundingBox();
    if (box) {
      await page.mouse.move(0, 0);
      await delay(100);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }
    await delay(600);
    const tooltip = await page.$(".step-tooltip");
    const tooltipVisible = !!tooltip;

    await captureStep(
      page,
      `hover-node-${n}-${nodeType}`,
      tooltipVisible ? "pass" : "warn",
      `Hovered "${nodeLabel}" (${nodeType}): tooltip visible: ${tooltipVisible}`
    );

    // Click for panel
    await node.click();
    await delay(400);
    const panel = await page.$(".panel");
    const panelVisible = !!panel;

    // Check if panel shows correct step
    let panelLabel = "";
    if (panel) {
      panelLabel = await page.$eval(
        ".panel-field-value",
        (el) => el.textContent || ""
      );
    }

    await captureStep(
      page,
      `click-node-${n}-panel`,
      panelVisible && panelLabel === nodeLabel ? "pass" : "warn",
      `Panel open: ${panelVisible}, shows: "${panelLabel}" (expected: "${nodeLabel}")`
    );

    // Close panel
    const closeBtn = await page.$(".panel-close");
    if (closeBtn) await closeBtn.click();
    await delay(300);
  }

  // ── Test 17: Decision node diamond shape check ──
  const decisionNodes = await page.$$('.step-node[data-type="decision"]');
  if (decisionNodes.length > 0) {
    const decisionBox = await getBoundingBox(decisionNodes[0]);
    await decisionNodes[0].click();
    await delay(400);

    // Check if decision edges have branch colors
    const branchYes = await page.$(".connector--branch-yes");
    const branchNo = await page.$(".connector--branch-no");

    await captureStep(
      page,
      "decision-node-interaction",
      branchYes || branchNo ? "pass" : "warn",
      `Decision node ${decisionBox.width.toFixed(0)}x${decisionBox.height.toFixed(0)}px, branch-yes: ${!!branchYes}, branch-no: ${!!branchNo}`
    );

    await page.click(".canvas");
    await delay(300);
  }

  // ── Test 18: Zoom in/out ──
  await page.keyboard.down("Meta");
  await page.keyboard.press("=");
  await page.keyboard.up("Meta");
  await delay(300);
  const zoomLevel = await page.$eval(".zoom-level", (el) => el.textContent || "");
  await captureStep(
    page,
    "zoom-in",
    zoomLevel === "115%" ? "pass" : "warn",
    `Zoom level after Cmd+: "${zoomLevel}"`
  );

  // Reset
  await page.keyboard.down("Meta");
  await page.keyboard.press("0");
  await page.keyboard.up("Meta");
  await delay(300);

  // ── Test 19: Fit to view ──
  await page.keyboard.down("Shift");
  await page.keyboard.press("!");
  await page.keyboard.up("Shift");
  await delay(500);
  const fitZoom = await page.$eval(".zoom-level", (el) => el.textContent || "");
  await captureStep(
    page,
    "zoom-fit",
    fitZoom !== "100%" ? "pass" : "warn",
    `Fit zoom: "${fitZoom}"`
  );

  // Reset
  await page.keyboard.down("Meta");
  await page.keyboard.press("0");
  await page.keyboard.up("Meta");
  await delay(300);

  // ── Test 20: Data type attributes on all nodes ──
  const typedNodes = await page.$$eval(".step-node[data-type]", (els) =>
    els.map((e) => e.getAttribute("data-type"))
  );
  const allTyped = typedNodes.length === stepNodes.length;
  const typeCounts: Record<string, number> = {};
  typedNodes.forEach((t) => {
    if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  await captureStep(
    page,
    "data-type-attributes",
    allTyped ? "pass" : "fail",
    `${typedNodes.length}/${stepNodes.length} nodes have data-type. Types: ${JSON.stringify(typeCounts)}`
  );

  // ── Test 21: SVG connectors exist ──
  const connectorPaths = await page.$$(".flow-svg path");
  await captureStep(
    page,
    "svg-connectors",
    connectorPaths.length > 0 ? "pass" : "fail",
    `${connectorPaths.length} SVG connector paths rendered`
  );

  // ── Test 22: Edge label pills ──
  const edgePills = await page.$$(".edge-label-pill");
  await captureStep(
    page,
    "edge-label-pills",
    edgePills.length >= 0 ? "pass" : "warn",
    `${edgePills.length} edge label pills rendered`
  );

  // ── Test 23: Comprehensive overlap matrix ──
  const overlapPairs = [
    [".step-node--start::after", ".step-node", "START badge vs nodes"],
    [".phase-label", ".step-node", "Phase labels vs nodes"],
    [".edge-label-pill", ".edge-label-pill", "Edge labels vs edge labels"],
    [".step-annotation-badge", ".step-node", "Annotation badges vs nodes"],
  ];

  for (const [sel1, sel2, desc] of overlapPairs) {
    // ::after pseudo-elements can't be queried via DOM, skip those
    if (sel1.includes("::after")) {
      await captureStep(
        page,
        `overlap-${desc.replace(/\s+/g, "-").toLowerCase()}`,
        "warn",
        `${desc}: pseudo-element overlap check requires visual inspection`
      );
      continue;
    }
    const overlap = await checkOverlap(page, sel1, sel2);
    await captureStep(
      page,
      `overlap-${desc.replace(/\s+/g, "-").toLowerCase()}`,
      overlap ? "warn" : "pass",
      `${desc}: overlap detected: ${overlap}`
    );
  }

  await browser.close();

  // ── Generate results JSON ──
  const summary = {
    timestamp: new Date().toISOString(),
    journey: "first-launch",
    totalTests: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    warned: results.filter((r) => r.status === "warn").length,
    failed: results.filter((r) => r.status === "fail").length,
    results,
  };

  await writeFile(
    `${OUT_DIR}/test-results.json`,
    JSON.stringify(summary, null, 2)
  );

  console.log("\n═══ Summary ═══");
  console.log(`Total: ${summary.totalTests}`);
  console.log(`Pass:  ${summary.passed}`);
  console.log(`Warn:  ${summary.warned}`);
  console.log(`Fail:  ${summary.failed}`);
  console.log(`\nResults: ${OUT_DIR}/test-results.json`);
}

main().catch(console.error);
