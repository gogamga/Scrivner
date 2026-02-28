/**
 * baseline.ts — Snapshot & diff for workflow definitions and annotations.
 *
 * Usage:
 *   bun baseline.ts save              # Save current state as baseline
 *   bun baseline.ts diff              # Diff current state against baseline
 *   bun baseline.ts diff --json       # Diff in JSON format
 */

import { join } from "path";

const DIR = import.meta.dir;
const WORKFLOWS_PATH = join(DIR, "workflow-defs.json");
const ANNOTATIONS_PATH = join(DIR, "annotations.json");
const BASELINE_DIR = join(DIR, "baselines");

interface Annotation {
  stepId: string;
  journeyId: string;
  type: string;
  text: string;
  priority: string;
  createdAt: string;
}

interface DiffResult {
  timestamp: string;
  baselineDate: string;
  annotations: {
    added: Annotation[];
    removed: Annotation[];
    total: { baseline: number; current: number };
  };
  workflows: {
    journeysAdded: string[];
    journeysRemoved: string[];
    stepsChanged: { journeyId: string; stepId: string; field: string; old: string; new: string }[];
  };
}

function annotationKey(a: Annotation): string {
  return `${a.journeyId}::${a.stepId}::${a.createdAt}`;
}

async function ensureBaselineDir() {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(BASELINE_DIR, { recursive: true });
}

async function saveBaseline() {
  await ensureBaselineDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const workflows = await Bun.file(WORKFLOWS_PATH).json();
  const annotations = await Bun.file(ANNOTATIONS_PATH).json();

  const baseline = {
    savedAt: new Date().toISOString(),
    workflows,
    annotations,
  };

  const path = join(BASELINE_DIR, `baseline-${timestamp}.json`);
  await Bun.write(path, JSON.stringify(baseline, null, 2));

  // Also save as "latest"
  const latestPath = join(BASELINE_DIR, "latest.json");
  await Bun.write(latestPath, JSON.stringify(baseline, null, 2));

  console.log(`Baseline saved: ${path}`);
  console.log(`Also saved as: ${latestPath}`);
}

async function diffBaseline(jsonMode: boolean) {
  const latestPath = join(BASELINE_DIR, "latest.json");
  const latestFile = Bun.file(latestPath);

  if (!(await latestFile.exists())) {
    console.error("No baseline found. Run `bun baseline.ts save` first.");
    process.exit(1);
  }

  const baseline = await latestFile.json();
  const currentWorkflows = await Bun.file(WORKFLOWS_PATH).json();
  const currentAnnotations = await Bun.file(ANNOTATIONS_PATH).json();

  const baseAnnotations: Annotation[] = baseline.annotations.annotations || [];
  const currAnnotations: Annotation[] = currentAnnotations.annotations || [];

  // Diff annotations
  const baseKeys = new Set(baseAnnotations.map(annotationKey));
  const currKeys = new Set(currAnnotations.map(annotationKey));

  const added = currAnnotations.filter((a) => !baseKeys.has(annotationKey(a)));
  const removed = baseAnnotations.filter((a) => !currKeys.has(annotationKey(a)));

  // Diff workflows (journey-level)
  const baseJourneyIds = new Set(
    (baseline.workflows.journeys || []).map((j: any) => j.id)
  );
  const currJourneyIds = new Set(
    (currentWorkflows.journeys || []).map((j: any) => j.id)
  );

  const journeysAdded = [...currJourneyIds].filter((id) => !baseJourneyIds.has(id));
  const journeysRemoved = [...baseJourneyIds].filter((id) => !currJourneyIds.has(id));

  // Diff step labels within shared journeys
  const stepsChanged: DiffResult["workflows"]["stepsChanged"] = [];
  const baseJourneyMap = new Map(
    (baseline.workflows.journeys || []).map((j: any) => [j.id, j])
  );

  for (const journey of currentWorkflows.journeys || []) {
    const baseJourney = baseJourneyMap.get(journey.id) as any;
    if (!baseJourney) continue;

    const baseStepMap = new Map(
      (baseJourney.steps || []).map((s: any) => [s.id, s])
    );

    for (const step of journey.steps || []) {
      const baseStep = baseStepMap.get(step.id) as any;
      if (!baseStep) continue;

      if (step.label !== baseStep.label) {
        stepsChanged.push({
          journeyId: journey.id,
          stepId: step.id,
          field: "label",
          old: baseStep.label,
          new: step.label,
        });
      }
    }
  }

  const result: DiffResult = {
    timestamp: new Date().toISOString(),
    baselineDate: baseline.savedAt,
    annotations: {
      added,
      removed,
      total: { baseline: baseAnnotations.length, current: currAnnotations.length },
    },
    workflows: {
      journeysAdded,
      journeysRemoved,
      stepsChanged,
    },
  };

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Text report
  console.log(`\nBaseline Diff Report`);
  console.log(`====================`);
  console.log(`Baseline from: ${result.baselineDate}`);
  console.log(`Current time:  ${result.timestamp}`);

  console.log(`\nAnnotations:`);
  console.log(`  Baseline: ${result.annotations.total.baseline}`);
  console.log(`  Current:  ${result.annotations.total.current}`);
  console.log(`  Added:    ${added.length}`);
  console.log(`  Removed:  ${removed.length}`);

  if (added.length > 0) {
    console.log(`\n  New annotations:`);
    for (const a of added) {
      console.log(`    + [${a.type}/${a.priority}] ${a.journeyId}/${a.stepId}: "${a.text}"`);
    }
  }

  if (removed.length > 0) {
    console.log(`\n  Resolved annotations:`);
    for (const a of removed) {
      console.log(`    - [${a.type}/${a.priority}] ${a.journeyId}/${a.stepId}: "${a.text}"`);
    }
  }

  if (journeysAdded.length > 0 || journeysRemoved.length > 0 || stepsChanged.length > 0) {
    console.log(`\nWorkflows:`);
    if (journeysAdded.length > 0) {
      console.log(`  Journeys added: ${journeysAdded.join(", ")}`);
    }
    if (journeysRemoved.length > 0) {
      console.log(`  Journeys removed: ${journeysRemoved.join(", ")}`);
    }
    if (stepsChanged.length > 0) {
      console.log(`\n  Step label changes:`);
      for (const c of stepsChanged) {
        console.log(`    ${c.journeyId}/${c.stepId}: "${c.old}" -> "${c.new}"`);
      }
    }
  }

  if (added.length === 0 && removed.length === 0 && journeysAdded.length === 0 && journeysRemoved.length === 0 && stepsChanged.length === 0) {
    console.log(`\nNo changes detected.`);
  }
}

async function restoreBaseline(timestamp?: string) {
  const { readdir } = await import("node:fs/promises");

  let snapshotPath: string;

  if (timestamp) {
    // Find snapshot matching the given timestamp prefix
    let files: string[];
    try {
      files = await readdir(BASELINE_DIR);
    } catch {
      console.error("No baselines directory found. Run `bun baseline.ts save` first.");
      process.exit(1);
    }

    const match = files.find(
      (f) => f.startsWith(`baseline-${timestamp}`) && f.endsWith(".json")
    );

    if (!match) {
      console.error(`No snapshot found matching timestamp: "${timestamp}"`);
      console.error(`Available snapshots:`);
      for (const f of files.filter((f) => f !== "latest.json" && f.endsWith(".json"))) {
        console.error(`  ${f}`);
      }
      process.exit(1);
    }

    snapshotPath = join(BASELINE_DIR, match);
  } else {
    snapshotPath = join(BASELINE_DIR, "latest.json");
  }

  const snapshotFile = Bun.file(snapshotPath);
  if (!(await snapshotFile.exists())) {
    console.error(`Snapshot not found: ${snapshotPath}`);
    process.exit(1);
  }

  const snapshot = await snapshotFile.json();

  if (!snapshot.workflows || !snapshot.annotations) {
    console.error("Invalid snapshot format — missing workflows or annotations.");
    process.exit(1);
  }

  await Bun.write(WORKFLOWS_PATH, JSON.stringify(snapshot.workflows, null, 2));
  await Bun.write(ANNOTATIONS_PATH, JSON.stringify(snapshot.annotations, null, 2));

  console.log(`Restored from: ${snapshotPath}`);
  console.log(`Snapshot date: ${snapshot.savedAt}`);
}

// Main
const command = process.argv[2];
const jsonMode = process.argv.includes("--json");
const timestampArg = process.argv[3];

switch (command) {
  case "save":
    await saveBaseline();
    break;
  case "diff":
    await diffBaseline(jsonMode);
    break;
  case "restore":
    await restoreBaseline(timestampArg);
    break;
  default:
    console.log("Usage:");
    console.log("  bun baseline.ts save                    Save current state as baseline");
    console.log("  bun baseline.ts diff                    Compare current vs baseline");
    console.log("  bun baseline.ts diff --json             Diff in JSON format");
    console.log("  bun baseline.ts restore                 Restore from latest snapshot");
    console.log("  bun baseline.ts restore <timestamp>     Restore from specific snapshot");
    break;
}
