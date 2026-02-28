#!/usr/bin/env bun
/**
 * baseline-diff.ts — Save, list, and diff workflow definitions and annotations.
 *
 * Usage:
 *   bun baseline-diff.ts save                  Save current state as a timestamped baseline
 *   bun baseline-diff.ts list                  List all saved baselines
 *   bun baseline-diff.ts diff                  Diff current state against latest baseline
 *   bun baseline-diff.ts diff <timestamp>      Diff current state against a specific baseline
 */

import { join } from "path";
import { mkdirSync, readdirSync } from "fs";

const WORKFLOWS_DIR = import.meta.dir;
const BASELINES_DIR = join(WORKFLOWS_DIR, "baselines");
const SOURCE_FILES = ["workflow-defs", "annotations"] as const;

// --- Types ---

interface Step {
  id: string;
  label: string;
  [key: string]: unknown;
}

interface Journey {
  id: string;
  name: string;
  steps: Step[];
  [key: string]: unknown;
}

interface WorkflowDefs {
  journeys: Journey[];
}

interface Annotation {
  stepId: string;
  journeyId: string;
  type: string;
  text: string;
  priority: string;
  createdAt: string;
  [key: string]: unknown;
}

interface Annotations {
  annotations: Annotation[];
}

// --- Helpers ---

function timestamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
}

function ensureBaselinesDir(): void {
  mkdirSync(BASELINES_DIR, { recursive: true });
}

/** Read and parse a JSON file, returning null if it doesn't exist. */
async function readJson<T>(path: string): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return file.json() as Promise<T>;
}

/** List baseline timestamps, sorted ascending. */
function listBaselineTimestamps(): string[] {
  ensureBaselinesDir();
  const files = readdirSync(BASELINES_DIR);
  const timestamps = new Set<string>();
  for (const f of files) {
    const match = f.match(/^(?:workflow-defs|annotations)-(.+)\.json$/);
    if (match) timestamps.add(match[1]);
  }
  return [...timestamps].sort();
}

function baselinePath(name: string, ts: string): string {
  return join(BASELINES_DIR, `${name}-${ts}.json`);
}

/** Build a key for an annotation to identify it across baselines. */
function annotationKey(a: Annotation): string {
  return `${a.journeyId}::${a.stepId}::${a.type}`;
}

// --- Commands ---

async function save(): Promise<void> {
  ensureBaselinesDir();
  const ts = timestamp();

  for (const name of SOURCE_FILES) {
    const src = join(WORKFLOWS_DIR, `${name}.json`);
    const dst = baselinePath(name, ts);
    const content = await Bun.file(src).text();
    await Bun.write(dst, content);
  }

  console.log(`Baseline saved: ${ts}`);
  console.log(`  ${baselinePath("workflow-defs", ts)}`);
  console.log(`  ${baselinePath("annotations", ts)}`);
}

function list(): void {
  const timestamps = listBaselineTimestamps();
  if (timestamps.length === 0) {
    console.log("No baselines found.");
    return;
  }
  console.log(`${timestamps.length} baseline(s):\n`);
  for (const ts of timestamps) {
    console.log(`  ${ts}`);
  }
}

async function diff(targetTs?: string): Promise<void> {
  const timestamps = listBaselineTimestamps();
  if (timestamps.length === 0) {
    console.error("No baselines found. Run 'save' first.");
    process.exit(1);
  }

  const ts = targetTs ?? timestamps[timestamps.length - 1];
  if (!timestamps.includes(ts)) {
    console.error(`Baseline "${ts}" not found. Available:`);
    for (const t of timestamps) console.error(`  ${t}`);
    process.exit(1);
  }

  console.log(`Diffing current state against baseline: ${ts}\n`);

  await diffWorkflowDefs(ts);
  console.log("");
  await diffAnnotations(ts);
}

async function diffWorkflowDefs(ts: string): Promise<void> {
  console.log("=== workflow-defs.json ===");

  const baseline = await readJson<WorkflowDefs>(baselinePath("workflow-defs", ts));
  const current = await readJson<WorkflowDefs>(join(WORKFLOWS_DIR, "workflow-defs.json"));

  if (!baseline || !current) {
    console.log("  (missing file — cannot diff)");
    return;
  }

  const baseJourneys = new Map(baseline.journeys.map((j) => [j.id, j]));
  const currJourneys = new Map(current.journeys.map((j) => [j.id, j]));

  // Added journeys
  const added = current.journeys.filter((j) => !baseJourneys.has(j.id));
  // Removed journeys
  const removed = baseline.journeys.filter((j) => !currJourneys.has(j.id));

  let changes = 0;

  if (added.length > 0) {
    console.log(`\n  + ${added.length} journey(s) added:`);
    for (const j of added) {
      console.log(`    + ${j.id} ("${j.name}", ${j.steps.length} steps)`);
      changes++;
    }
  }

  if (removed.length > 0) {
    console.log(`\n  - ${removed.length} journey(s) removed:`);
    for (const j of removed) {
      console.log(`    - ${j.id} ("${j.name}")`);
      changes++;
    }
  }

  // Diff steps within shared journeys
  const shared = current.journeys.filter((j) => baseJourneys.has(j.id));
  for (const currJ of shared) {
    const baseJ = baseJourneys.get(currJ.id)!;
    const baseSteps = new Map(baseJ.steps.map((s) => [s.id, s]));
    const currSteps = new Map(currJ.steps.map((s) => [s.id, s]));

    const addedSteps = currJ.steps.filter((s) => !baseSteps.has(s.id));
    const removedSteps = baseJ.steps.filter((s) => !currSteps.has(s.id));
    const labelChanges: { id: string; old: string; new: string }[] = [];

    for (const s of currJ.steps) {
      const base = baseSteps.get(s.id);
      if (base && base.label !== s.label) {
        labelChanges.push({ id: s.id, old: base.label, new: s.label });
      }
    }

    if (addedSteps.length > 0 || removedSteps.length > 0 || labelChanges.length > 0) {
      console.log(`\n  Journey "${currJ.id}":`);

      for (const s of addedSteps) {
        console.log(`    + step "${s.id}" ("${s.label}")`);
        changes++;
      }
      for (const s of removedSteps) {
        console.log(`    - step "${s.id}" ("${s.label}")`);
        changes++;
      }
      for (const c of labelChanges) {
        console.log(`    ~ step "${c.id}" label: "${c.old}" -> "${c.new}"`);
        changes++;
      }
    }
  }

  if (changes === 0) {
    console.log("  No changes.");
  }
}

async function diffAnnotations(ts: string): Promise<void> {
  console.log("=== annotations.json ===");

  const baseline = await readJson<Annotations>(baselinePath("annotations", ts));
  const current = await readJson<Annotations>(join(WORKFLOWS_DIR, "annotations.json"));

  if (!baseline || !current) {
    console.log("  (missing file — cannot diff)");
    return;
  }

  const baseMap = new Map(baseline.annotations.map((a) => [annotationKey(a), a]));
  const currMap = new Map(current.annotations.map((a) => [annotationKey(a), a]));

  let changes = 0;

  // New annotations
  for (const [key, a] of currMap) {
    if (!baseMap.has(key)) {
      console.log(`  + [${a.journeyId}/${a.stepId}] (${a.type}) "${a.text}"`);
      changes++;
    }
  }

  // Removed annotations
  for (const [key, a] of baseMap) {
    if (!currMap.has(key)) {
      console.log(`  - [${a.journeyId}/${a.stepId}] (${a.type}) "${a.text}"`);
      changes++;
    }
  }

  // Changed annotations (same key, different text or priority)
  for (const [key, curr] of currMap) {
    const base = baseMap.get(key);
    if (!base) continue;
    const diffs: string[] = [];
    if (base.text !== curr.text) diffs.push(`text: "${base.text}" -> "${curr.text}"`);
    if (base.priority !== curr.priority) diffs.push(`priority: ${base.priority} -> ${curr.priority}`);
    if (diffs.length > 0) {
      console.log(`  ~ [${curr.journeyId}/${curr.stepId}] (${curr.type}) ${diffs.join(", ")}`);
      changes++;
    }
  }

  if (changes === 0) {
    console.log("  No changes.");
  }
}

// --- CLI ---

const [command, arg] = process.argv.slice(2);

switch (command) {
  case "save":
    await save();
    break;
  case "list":
    list();
    break;
  case "diff":
    await diff(arg);
    break;
  default:
    console.log("Usage: bun baseline-diff.ts <save|list|diff> [timestamp]");
    process.exit(command ? 1 : 0);
}
