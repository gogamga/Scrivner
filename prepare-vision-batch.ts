/**
 * prepare-vision-batch.ts — Generate Anthropic batch request JSON for vision analysis
 * of all 11 workflow journey screenshots.
 * Usage: bun prepare-vision-batch.ts
 * Output: /tmp/workflow-vision-batch.json
 */
import { readFile, writeFile } from "node:fs/promises";

const SCREENSHOTS_DIR = import.meta.dir + "/screenshots";
const OUT_PATH = "/tmp/workflow-vision-batch.json";

const JOURNEYS = [
  { id: "01", slug: "first-launch", name: "First Launch" },
  { id: "02", slug: "capture-via-app", name: "Capture via App" },
  { id: "03", slug: "capture-via-share-sheet", name: "Capture via Share Sheet" },
  { id: "04", slug: "capture-via-voice", name: "Capture via Voice" },
  { id: "05", slug: "browse-search", name: "Browse & Search" },
  { id: "06", slug: "view-edit", name: "View & Edit" },
  { id: "07", slug: "ai-configuration", name: "AI Configuration" },
  { id: "08", slug: "prompt-templates", name: "Prompt Templates" },
  { id: "09", slug: "security-privacy", name: "Security & Privacy" },
  { id: "10", slug: "sync-export", name: "Sync & Export" },
  { id: "11", slug: "premium", name: "Premium" },
];

// Per-journey DOM test results (from gui-test-all.ts run)
const DOM_RESULTS: Record<string, { nodes: number; phases: number; warnings: string[] }> = {
  "first-launch": { nodes: 11, phases: 3, warnings: ["edge-label-overlap", "annotation-badge-overlap"] },
  "capture-via-app": { nodes: 9, phases: 3, warnings: ["phase-overlap"] },
  "capture-via-share-sheet": { nodes: 13, phases: 3, warnings: ["edge-label-overlap", "phase-overlap"] },
  "capture-via-voice": { nodes: 10, phases: 3, warnings: ["edge-label-overlap", "phase-overlap"] },
  "browse-search": { nodes: 12, phases: 3, warnings: ["edge-label-overlap", "phase-overlap"] },
  "view-edit": { nodes: 14, phases: 3, warnings: ["edge-label-overlap", "phase-overlap", "decision-branch-colors"] },
  "ai-configuration": { nodes: 14, phases: 3, warnings: ["edge-label-overlap", "phase-overlap"] },
  "prompt-templates": { nodes: 12, phases: 3, warnings: ["edge-label-overlap", "phase-overlap"] },
  "security-privacy": { nodes: 9, phases: 3, warnings: ["phase-overlap"] },
  "sync-export": { nodes: 12, phases: 3, warnings: ["phase-overlap"] },
  "premium": { nodes: 9, phases: 3, warnings: ["edge-label-overlap"] },
};

const ANALYSIS_PROMPT = (name: string, domInfo: { nodes: number; phases: number; warnings: string[] }) =>
  `Analyze this workflow diagram screenshot for the "${name}" user journey in the ExampleApp iOS app.

DOM test findings: ${domInfo.nodes} nodes, ${domInfo.phases} phase containers.
Warnings from DOM tests: ${domInfo.warnings.length > 0 ? domInfo.warnings.join(", ") : "none"}.

Visually check:
1. Decision nodes — are any nodes diamond-shaped with an orange border? Or do they look like plain rounded rectangles?
2. Phase containers — do they have dashed borders with phase labels in the top-left corner?
3. Node overlap — do any nodes visually overlap each other?
4. Edge labels — are label pills readable without being obscured by nodes?
5. START/END badges — are green START and red END badges clearly visible?
6. Visual hierarchy — can you distinguish node types (action, display, input, system, decision) by color/shape?
7. Tooltip rendering — if any tooltips are visible, do they appear correctly styled?

Report findings as JSON:
{
  "journey": "${name}",
  "issues": [
    {"type": "...", "severity": "critical|moderate|minor", "description": "..."}
  ],
  "positives": ["..."],
  "score": 0-100,
  "summary": "one sentence"
}`;

async function main() {
  const requests = [];

  for (const j of JOURNEYS) {
    const imgPath = `${SCREENSHOTS_DIR}/${j.id}-${j.slug}-fit.png`;
    let imgBase64: string;
    try {
      const data = await readFile(imgPath);
      imgBase64 = data.toString("base64");
    } catch (e) {
      console.warn(`Missing screenshot: ${imgPath}`);
      continue;
    }

    const dom = DOM_RESULTS[j.slug];
    requests.push({
      custom_id: `vision-${j.id}-${j.slug}`,
      params: {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: imgBase64,
                },
              },
              {
                type: "text",
                text: ANALYSIS_PROMPT(j.name, dom),
              },
            ],
          },
        ],
      },
    });

    console.log(`  Prepared: ${j.id}-${j.slug} (${imgBase64.length.toLocaleString()} base64 chars)`);
  }

  await writeFile(OUT_PATH, JSON.stringify(requests, null, 0));
  const stats = await Bun.file(OUT_PATH).size;
  console.log(`\nBatch JSON written to: ${OUT_PATH}`);
  console.log(`Total requests: ${requests.length}`);
  console.log(`File size: ${(stats / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);
