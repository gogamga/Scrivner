/**
 * send-vision-batches.ts — Send individual vision batch requests for each journey.
 * Uses the /tmp/workflow-thumbs/ resized screenshots (720x450).
 * Outputs job IDs to /tmp/vision-batch-jobs.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const THUMBS_DIR = "/tmp/workflow-thumbs";

const JOURNEYS = [
  { id: "01", slug: "first-launch", name: "First Launch", warnings: ["edge-label-overlap", "annotation-badge-overlap"] },
  { id: "06", slug: "view-edit", name: "View & Edit", warnings: ["edge-label-overlap", "phase-overlap", "decision-branch-colors"] },
  { id: "03", slug: "capture-via-share-sheet", name: "Capture via Share Sheet", warnings: ["edge-label-overlap", "phase-overlap"] },
  { id: "07", slug: "ai-configuration", name: "AI Configuration", warnings: ["edge-label-overlap", "phase-overlap"] },
];

const ANALYSIS_PROMPT = (name: string, warnings: string[]) =>
  `Analyze this workflow diagram screenshot for the "${name}" user journey.

DOM test warnings detected: ${warnings.join(", ")}.

Check visually:
1. Decision nodes — diamond shape with orange border? Or plain rounded rectangles?
2. Phase containers — dashed borders with labels at top-left?
3. Edge label pills — are they readable or hidden under nodes?
4. START/END badges — clearly visible green/red pills?
5. Visual hierarchy — node types distinguishable by color?

Report as JSON: {"journey":"${name}","issues":[{"type":"...","severity":"critical|moderate|minor","description":"..."}],"positives":["..."],"score":0-100}`;

const jobs: Array<{ journey: string; jobId: string }> = [];

for (const j of JOURNEYS) {
  const imgPath = `${THUMBS_DIR}/${j.id}-${j.slug}-fit.png`;

  let imgBase64: string;
  try {
    const data = await readFile(imgPath);
    imgBase64 = data.toString("base64");
  } catch {
    console.warn(`Missing: ${imgPath}`);
    continue;
  }

  // Write single-request batch JSON
  const tmpPath = `/tmp/vision-${j.id}.json`;
  const request = [
    {
      custom_id: `vision-${j.id}-${j.slug}`,
      params: {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: imgBase64 },
              },
              { type: "text", text: ANALYSIS_PROMPT(j.name, j.warnings) },
            ],
          },
        ],
      },
    },
  ];

  await writeFile(tmpPath, JSON.stringify(request));
  const b64len = imgBase64.length;
  const estimatedTokens = Math.round(b64len / 4 * 0.75 / 100 * 0.375) + 500; // rough estimate
  console.log(`  ${j.id}-${j.slug}: ${(b64len / 1024).toFixed(0)}KB base64, ~${estimatedTokens}k tokens → ${tmpPath}`);
  jobs.push({ journey: j.name, jobId: tmpPath });
}

await writeFile("/tmp/vision-batch-jobs.json", JSON.stringify(jobs, null, 2));
console.log("\nFiles ready. Pass each path to send_to_batch with packet_path.");
console.log(jobs.map((j) => j.jobId).join("\n"));
