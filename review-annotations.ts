#!/usr/bin/env bun
/**
 * review-annotations.ts -- Annotation-to-code change pipeline
 *
 * Reads annotations.json and workflow-defs.json, traces each annotation
 * to its Swift source file via journey/step lookup, and generates a
 * prioritized review report.
 *
 * Usage:
 *   bun review-annotations.ts              # text report to stdout
 *   bun review-annotations.ts --json       # JSON report to stdout
 *   bun review-annotations.ts --check-files # verify Swift files exist on disk
 */

import { resolve, join } from "path";

// -- Types ------------------------------------------------------------------

interface Step {
  id: string;
  label: string;
  screen: string;
  swiftFile: string | null;
  type: "action" | "display" | "decision" | "input" | "system";
  next: string[];
  edgeLabels?: string[];
}

interface Journey {
  id: string;
  name: string;
  description: string;
  group: string;
  steps: Step[];
}

interface Annotation {
  stepId: string;
  journeyId: string;
  type: "note" | "change-request" | "bug" | "question";
  text: string;
  priority: "suggestion" | "required" | "blocker";
  createdAt: string;
}

interface ResolvedAnnotation {
  index: number;
  annotation: Annotation;
  journeyName: string;
  stepLabel: string;
  swiftFile: string | null;
  fileExists?: boolean;
  branches?: string[];
}

interface JsonReport {
  generated: string;
  total: number;
  typeCounts: Record<string, number>;
  blockers: ResolvedAnnotation[];
  required: ResolvedAnnotation[];
  suggestions: ResolvedAnnotation[];
}

// -- Constants --------------------------------------------------------------

const PROJECT_ROOT = process.env.APP_REPO_PATH;
if (!PROJECT_ROOT) {
  throw new Error("APP_REPO_PATH environment variable is required.");
}

/** Lower number = higher priority in sort order. */
const PRIORITY_RANK: Record<string, number> = {
  blocker: 0,
  required: 1,
  suggestion: 2,
};

/** Lower number = higher severity in sort order within a priority group. */
const TYPE_RANK: Record<string, number> = {
  bug: 0,
  "change-request": 1,
  question: 2,
  note: 3,
};

// -- Data Loading -----------------------------------------------------------

async function loadAnnotations(): Promise<Annotation[]> {
  const path = join(import.meta.dir, "annotations.json");
  const file = Bun.file(path);
  const data = await file.json();
  return data.annotations ?? [];
}

async function loadWorkflows(): Promise<Journey[]> {
  const path = join(import.meta.dir, "workflow-defs.json");
  const file = Bun.file(path);
  const data = await file.json();
  return data.journeys ?? [];
}

// -- Step Index -------------------------------------------------------------

type StepMatch = { journey: Journey; step: Step };

function buildStepIndex(journeys: Journey[]): Map<string, StepMatch> {
  const index = new Map<string, StepMatch>();
  for (const journey of journeys) {
    for (const step of journey.steps) {
      index.set(`${journey.id}::${step.id}`, { journey, step });
    }
  }
  return index;
}

// -- Resolution -------------------------------------------------------------

function resolveAnnotations(
  annotations: Annotation[],
  journeys: Journey[],
): ResolvedAnnotation[] {
  const stepIndex = buildStepIndex(journeys);

  return annotations.map((annotation) => {
    const key = `${annotation.journeyId}::${annotation.stepId}`;
    const match = stepIndex.get(key);

    const step = match?.step;
    const branches = step?.edgeLabels?.map((lbl, i) => `${lbl} -> ${step.next[i]}`);

    return {
      index: 0, // assigned after sorting
      annotation,
      journeyName: match?.journey.name ?? annotation.journeyId,
      stepLabel: step?.label ?? annotation.stepId,
      swiftFile: step?.swiftFile ?? null,
      branches,
    };
  });
}

// -- File Existence ---------------------------------------------------------

async function checkFileExistence(items: ResolvedAnnotation[]): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      if (item.swiftFile) {
        const fullPath = resolve(PROJECT_ROOT, item.swiftFile);
        const file = Bun.file(fullPath);
        item.fileExists = await file.exists();
      }
    }),
  );
}

// -- Sorting & Grouping -----------------------------------------------------

function sortWithinGroup(items: ResolvedAnnotation[]): ResolvedAnnotation[] {
  return items.sort((a, b) => {
    const ta = TYPE_RANK[a.annotation.type] ?? 99;
    const tb = TYPE_RANK[b.annotation.type] ?? 99;
    if (ta !== tb) return ta - tb;
    return a.annotation.createdAt.localeCompare(b.annotation.createdAt);
  });
}

function groupByPriority(items: ResolvedAnnotation[]): {
  blockers: ResolvedAnnotation[];
  required: ResolvedAnnotation[];
  suggestions: ResolvedAnnotation[];
} {
  const blockers: ResolvedAnnotation[] = [];
  const required: ResolvedAnnotation[] = [];
  const suggestions: ResolvedAnnotation[] = [];

  for (const item of items) {
    switch (item.annotation.priority) {
      case "blocker":
        blockers.push(item);
        break;
      case "required":
        required.push(item);
        break;
      default:
        suggestions.push(item);
        break;
    }
  }

  return {
    blockers: sortWithinGroup(blockers),
    required: sortWithinGroup(required),
    suggestions: sortWithinGroup(suggestions),
  };
}

/** Assign sequential 1-based indices across all groups in display order. */
function assignIndices(groups: {
  blockers: ResolvedAnnotation[];
  required: ResolvedAnnotation[];
  suggestions: ResolvedAnnotation[];
}): void {
  let idx = 1;
  for (const item of [...groups.blockers, ...groups.required, ...groups.suggestions]) {
    item.index = idx++;
  }
}

// -- Type Counts ------------------------------------------------------------

function countByType(annotations: Annotation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of annotations) {
    counts[a.type] = (counts[a.type] || 0) + 1;
  }
  return counts;
}

function formatTypeSummary(total: number, typeCounts: Record<string, number>): string {
  const parts = Object.entries(typeCounts)
    .sort(([a], [b]) => (TYPE_RANK[a] ?? 99) - (TYPE_RANK[b] ?? 99))
    .map(([type, count]) => `${count} ${count === 1 ? type : type + "s"}`);

  return `${total} annotations (${parts.join(", ")})`;
}

// -- Text Report ------------------------------------------------------------

function formatEntry(item: ResolvedAnnotation, checkFiles: boolean): string {
  const a = item.annotation;
  const lines: string[] = [];

  lines.push(`[${item.index}] ${a.type.toUpperCase()} \u2014 ${a.journeyId} / ${a.stepId}`);
  lines.push(`    Priority: ${a.priority}`);
  lines.push(`    File: ${item.swiftFile || "(no file mapped)"}`);

  if (checkFiles && item.swiftFile && item.fileExists === false) {
    lines.push(`    WARNING: File not found at ${resolve(PROJECT_ROOT, item.swiftFile)}`);
  }

  if (item.branches && item.branches.length > 0) {
    lines.push(`    Branches: ${item.branches.join(", ")}`);
  }
  lines.push(`    Note: "${a.text}"`);
  lines.push(`    Created: ${a.createdAt}`);

  return lines.join("\n");
}

function generateTextReport(
  annotations: Annotation[],
  resolved: ResolvedAnnotation[],
  checkFiles: boolean,
): string {
  const now = new Date().toISOString();
  const typeCounts = countByType(annotations);
  const groups = groupByPriority(resolved);
  assignIndices(groups);

  const lines: string[] = [];
  lines.push("=== Annotation Review Report ===");
  lines.push(`Generated: ${now}`);
  lines.push(`Total: ${formatTypeSummary(annotations.length, typeCounts)}`);

  if (groups.blockers.length > 0) {
    lines.push("");
    lines.push(`--- BLOCKERS (${groups.blockers.length}) ---`);
    lines.push("");
    for (const item of groups.blockers) {
      lines.push(formatEntry(item, checkFiles));
      lines.push("");
    }
  }

  if (groups.required.length > 0) {
    lines.push(`--- REQUIRED (${groups.required.length}) ---`);
    lines.push("");
    for (const item of groups.required) {
      lines.push(formatEntry(item, checkFiles));
      lines.push("");
    }
  }

  if (groups.suggestions.length > 0) {
    lines.push(`--- SUGGESTIONS (${groups.suggestions.length}) ---`);
    lines.push("");
    for (const item of groups.suggestions) {
      lines.push(formatEntry(item, checkFiles));
      lines.push("");
    }
  }

  return lines.join("\n");
}

// -- JSON Report ------------------------------------------------------------

function generateJsonReport(
  annotations: Annotation[],
  resolved: ResolvedAnnotation[],
): JsonReport {
  const groups = groupByPriority(resolved);
  assignIndices(groups);

  return {
    generated: new Date().toISOString(),
    total: annotations.length,
    typeCounts: countByType(annotations),
    blockers: groups.blockers,
    required: groups.required,
    suggestions: groups.suggestions,
  };
}

// -- Main -------------------------------------------------------------------

async function main() {
  const args = Bun.argv.slice(2);
  const jsonMode = args.includes("--json");
  const checkFiles = args.includes("--check-files");

  const [annotations, journeys] = await Promise.all([
    loadAnnotations(),
    loadWorkflows(),
  ]);

  if (annotations.length === 0) {
    console.log("No annotations found.");
    return;
  }

  const resolved = resolveAnnotations(annotations, journeys);

  if (checkFiles) {
    await checkFileExistence(resolved);
  }

  if (jsonMode) {
    const report = generateJsonReport(annotations, resolved);
    console.log(JSON.stringify(report, null, 2));
  } else {
    const report = generateTextReport(annotations, resolved, checkFiles);
    console.log(report);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
