/**
 * gui-test-all.ts — Automated GUI test for all 11 workflow journeys.
 * Extends gui-test-pilot.ts to iterate every journey card in the sidebar.
 * For each journey, runs the full test battery and captures screenshots.
 * Usage: bun gui-test-all.ts
 * Output: screenshots/gui-test/all-journeys-results.json
 */
import puppeteer, { type Page, type ElementHandle } from "puppeteer";
import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL = "http://localhost:8091";
const GUI_DIR = import.meta.dir + "/screenshots/gui-test";
const VIEWPORT = { width: 1440, height: 900 };

interface TestResult {
  step: string;
  status: "pass" | "fail" | "warn";
  observation: string;
  screenshot: string;
}

interface JourneyResult {
  index: number;
  slug: string;
  name: string;
  totalTests: number;
  passed: number;
  warned: number;
  failed: number;
  score: number;
  results: TestResult[];
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
          if (ra.left < rb.right && ra.right > rb.left && ra.top < rb.bottom && ra.bottom > rb.top) {
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

async function testJourney(
  page: Page,
  journeyIndex: number,
  journeySlug: string,
  journeyName: string
): Promise<JourneyResult> {
  const outDir = `${GUI_DIR}/journeys/${journeySlug}`;
  await mkdir(outDir, { recursive: true });

  const results: TestResult[] = [];
  let stepNum = 0;

  async function capture(
    name: string,
    status: TestResult["status"],
    observation: string
  ) {
    stepNum++;
    const filename = `${String(stepNum).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: `${outDir}/${filename}`, fullPage: false });
    results.push({ step: name, status, observation, screenshot: filename });
    const icon = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "WARN";
    console.log(`    [${icon}] ${name}: ${observation}`);
  }

  // ── T1: Step nodes rendered ──
  const stepNodes = await page.$$(".step-node");
  await capture(
    "step-nodes-count",
    stepNodes.length > 0 ? "pass" : "fail",
    `${stepNodes.length} step nodes rendered`
  );

  // ── T2: Start node exists ──
  const startNode = await page.$(".step-node--start");
  await capture(
    "start-node",
    startNode ? "pass" : "fail",
    `Start node present: ${!!startNode}`
  );

  // ── T3: End node(s) exist ──
  const endNodes = await page.$$(".step-node--end");
  await capture(
    "end-nodes",
    endNodes.length > 0 ? "pass" : "fail",
    `${endNodes.length} end node(s) found`
  );

  // ── T4: Phase containers rendered ──
  const phaseContainers = await page.$$(".phase-container");
  const phaseLabels = await page.$$eval(".phase-label", (els) =>
    els.map((e) => e.textContent?.trim() || "")
  );
  await capture(
    "phase-containers",
    phaseContainers.length > 0 ? "pass" : "fail",
    `${phaseContainers.length} phases: [${phaseLabels.join(", ")}]`
  );

  // ── T5: Node-to-node overlap ──
  const nodeOverlap = await checkOverlap(page, ".step-node", ".step-node");
  await capture(
    "node-overlap-check",
    nodeOverlap ? "fail" : "pass",
    `Node overlap: ${nodeOverlap}`
  );

  // ── T6: Edge label overlap with nodes ──
  const labelOverlap = await checkOverlap(page, ".edge-label-pill", ".step-node");
  await capture(
    "edge-label-overlap",
    labelOverlap ? "warn" : "pass",
    `Edge labels overlapping nodes: ${labelOverlap}`
  );

  // ── T7: Phase container overlap ──
  const phaseOverlap = await checkOverlap(page, ".phase-container", ".phase-container");
  await capture(
    "phase-overlap",
    phaseOverlap ? "warn" : "pass",
    `Phase container overlap: ${phaseOverlap}`
  );

  // ── T8: START badge clipping ──
  if (startNode) {
    const startBox = await getBoundingBox(startNode);
    const canvasY = await page.$eval(".canvas", (el) => el.getBoundingClientRect().y);
    const clipped = startBox.y < canvasY;
    await capture(
      "start-badge-clipping",
      clipped ? "warn" : "pass",
      `Start top: ${startBox.y.toFixed(0)}px, canvas top: ${canvasY.toFixed(0)}px, clipped: ${clipped}`
    );
  }

  // ── T9-11: Hover first 3 nodes for tooltip ──
  // Use dispatchEvent (better than Puppeteer hover for React in headless mode)
  const nodes = await page.$$(".step-node");
  for (let n = 0; n < Math.min(3, nodes.length); n++) {
    const node = nodes[n];
    if (!node) continue;

    const nodeLabel = await node.$eval(".step-node-label", (el) => el.textContent?.trim() || "").catch(() => "");
    const nodeType = await node.evaluate((el) => el.getAttribute("data-type") || "unknown");

    // Scroll into view then dispatch mouseenter
    await node.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
    await delay(150);
    await page.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("mouseenter", {
        bubbles: false,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
      el.dispatchEvent(new MouseEvent("mouseover", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
    }, node);
    await delay(600);

    const tooltip = await page.$(".step-tooltip");
    await capture(
      `hover-node-${n}-${nodeType}`,
      tooltip ? "pass" : "warn",
      `Hovered "${nodeLabel}" (${nodeType}): tooltip: ${!!tooltip}`
    );

    // Dismiss tooltip
    await page.evaluate((el) => {
      el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
    }, node);
    await delay(200);
  }

  // ── T12: Click first node → panel correct ──
  if (nodes.length > 0) {
    const firstNode = nodes[0];
    const expectedLabel = await firstNode.$eval(".step-node-label", (el) => el.textContent?.trim() || "").catch(() => "");
    await firstNode.click();
    await delay(400);

    const panel = await page.$(".panel");
    let panelLabel = "";
    if (panel) {
      panelLabel = await page.$eval(".panel-field-value", (el) => el.textContent || "").catch(() => "");
    }

    await capture(
      "click-first-node-panel",
      panel && panelLabel === expectedLabel ? "pass" : "warn",
      `Panel: ${!!panel}, shows: "${panelLabel}" (expected: "${expectedLabel}")`
    );

    // Close panel
    const closeBtn = await page.$(".panel-close");
    if (closeBtn) await closeBtn.click();
    await delay(300);
  }

  // ── T13: Decision node interaction (if present) ──
  const decisionNodes = await page.$$('.step-node[data-type="decision"]');
  if (decisionNodes.length > 0) {
    await decisionNodes[0].click();
    await delay(400);

    const decisionBox = await getBoundingBox(decisionNodes[0]);
    const branchYes = await page.$(".connector--branch-yes");
    const branchNo = await page.$(".connector--branch-no");

    await capture(
      "decision-node-interaction",
      branchYes || branchNo ? "pass" : "warn",
      `Decision ${decisionBox.width.toFixed(0)}x${decisionBox.height.toFixed(0)}px, branch-yes: ${!!branchYes}, branch-no: ${!!branchNo}`
    );

    await page.click(".canvas");
    await delay(300);
  }

  // ── T14: Data-type attributes on all nodes ──
  const typedNodes = await page.$$eval(".step-node[data-type]", (els) =>
    els.map((e) => e.getAttribute("data-type"))
  );
  const allTyped = typedNodes.length === stepNodes.length;
  const typeCounts: Record<string, number> = {};
  typedNodes.forEach((t) => { if (t) typeCounts[t] = (typeCounts[t] || 0) + 1; });

  await capture(
    "data-type-attributes",
    allTyped ? "pass" : "fail",
    `${typedNodes.length}/${stepNodes.length} typed. Types: ${JSON.stringify(typeCounts)}`
  );

  // ── T15: SVG connectors ──
  const connectors = await page.$$(".flow-svg path");
  await capture(
    "svg-connectors",
    connectors.length > 0 ? "pass" : "fail",
    `${connectors.length} connector paths`
  );

  // ── T16: Edge label pills ──
  const pills = await page.$$(".edge-label-pill");
  await capture(
    "edge-label-pills",
    pills.length >= 0 ? "pass" : "warn",
    `${pills.length} edge label pills`
  );

  // ── T17: Annotation badge overlap ──
  const badgeOverlap = await checkOverlap(page, ".step-annotation-badge", ".step-node");
  await capture(
    "annotation-badge-overlap",
    badgeOverlap ? "warn" : "pass",
    `Annotation badge overlap: ${badgeOverlap}`
  );

  const passed = results.filter((r) => r.status === "pass").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const score = Math.round((passed / results.length) * 100);

  return {
    index: journeyIndex + 1,
    slug: journeySlug,
    name: journeyName,
    totalTests: results.length,
    passed,
    warned,
    failed,
    score,
    results,
  };
}

async function main() {
  await mkdir(`${GUI_DIR}/journeys`, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle0" });
  await delay(1500);

  // ── Discover all journeys ──
  const journeyCount = await page.$$eval(".journey-card", (cards) => cards.length);
  console.log(`\n═══ GUI Test All: ${journeyCount} journeys ═══\n`);

  const allResults: JourneyResult[] = [];

  for (let i = 0; i < journeyCount; i++) {
    // Re-query cards on each iteration (DOM can shift)
    const cards = await page.$$(".journey-card");
    const card = cards[i];
    if (!card) continue;

    const journeyName = await card.$eval(
      ".journey-card-name",
      (el) => el.textContent?.trim() || `Journey ${i + 1}`
    );
    const slug = `${String(i + 1).padStart(2, "0")}-${journeyName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    console.log(`\n── Journey ${i + 1}/${journeyCount}: ${journeyName} (${slug}) ──`);

    // Navigate to this journey
    await card.click();
    await delay(900); // wait for render + auto-center

    // Run the test battery
    const journeyResult = await testJourney(page, i, slug, journeyName);
    allResults.push(journeyResult);

    console.log(
      `  → ${journeyResult.passed}/${journeyResult.totalTests} pass (${journeyResult.score}%)`
    );
  }

  await browser.close();

  // ── Aggregate summary ──
  const totalTests = allResults.reduce((s, j) => s + j.totalTests, 0);
  const totalPassed = allResults.reduce((s, j) => s + j.passed, 0);
  const totalWarned = allResults.reduce((s, j) => s + j.warned, 0);
  const totalFailed = allResults.reduce((s, j) => s + j.failed, 0);

  const output = {
    timestamp: new Date().toISOString(),
    totalJourneys: allResults.length,
    totalTests,
    totalPassed,
    totalWarned,
    totalFailed,
    overallScore: Math.round((totalPassed / totalTests) * 100),
    journeys: allResults,
  };

  const outPath = `${GUI_DIR}/all-journeys-results.json`;
  await writeFile(outPath, JSON.stringify(output, null, 2));

  // ── Print table ──
  console.log("\n═══ Per-Journey Summary ═══\n");
  console.log("Journey".padEnd(36) + "Tests".padEnd(8) + "Pass".padEnd(7) + "Warn".padEnd(7) + "Fail".padEnd(7) + "Score");
  console.log("─".repeat(70));
  for (const j of allResults) {
    console.log(
      j.name.padEnd(36) +
      String(j.totalTests).padEnd(8) +
      String(j.passed).padEnd(7) +
      String(j.warned).padEnd(7) +
      String(j.failed).padEnd(7) +
      `${j.score}%`
    );
  }
  console.log("─".repeat(70));
  console.log(
    "TOTAL".padEnd(36) +
    String(totalTests).padEnd(8) +
    String(totalPassed).padEnd(7) +
    String(totalWarned).padEnd(7) +
    String(totalFailed).padEnd(7) +
    `${output.overallScore}%`
  );
  console.log(`\nResults: ${outPath}`);
}

main().catch(console.error);
