/**
 * sync/merge.ts — Pure function: merge ScanResult + ParsedViews into WorkflowDefs.
 *
 * Rules:
 * - New files: add step with _needsReview:true, assign to journey by path heuristic
 * - Removed files: mark step deprecated:true (never delete)
 * - Modified files: re-parse edges, update next[], preserve edgeLabels
 */

import type { ScanResult } from "./scan";
import type { ParsedView } from "./parse";

// ── Types (mirrors export-mermaid.ts) ─────────────────────────────

export interface Step {
  id: string;
  label: string;
  screen: string;
  swiftFile: string | null;
  type: "action" | "display" | "decision" | "input" | "system";
  phase: string;
  next: string[];
  edgeLabels?: string[];
  deprecated?: boolean;
  _needsReview?: boolean;
}

export interface Journey {
  id: string;
  name: string;
  description: string;
  group?: string;
  steps: Step[];
}

export interface WorkflowDefs {
  version?: string;
  generatedAt?: string;
  journeys: Journey[];
}

export interface ChangeRecord {
  action: string;
  journeyId: string;
  stepId: string;
  detail: string;
}

export interface MergeResult {
  json: WorkflowDefs;
  changes: ChangeRecord[];
  reviewCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Determine journey ID for a new file based on path + existing graph */
function assignJourney(
  filePath: string,
  structName: string,
  parsedView: ParsedView,
  defs: WorkflowDefs
): string {
  // Path-based heuristics
  if (filePath.startsWith("ExampleApp/Sources/UI/Onboarding/")) return "first-launch";
  if (filePath.startsWith("ExampleAppShare/")) return "capture-via-share";
  if (filePath.startsWith("ExampleAppAction/")) return "capture-via-action";

  // Check if any existing step presents to this view
  for (const journey of defs.journeys) {
    for (const step of journey.steps) {
      if (step.next.some((nextId) => {
        // Find the step with nextId and check if its screen matches structName
        const nextStep = journey.steps.find((s) => s.id === nextId);
        return nextStep?.screen === structName;
      })) {
        return journey.id;
      }
    }
  }

  // Check if any parsed edge points here from an existing step
  for (const journey of defs.journeys) {
    for (const step of journey.steps) {
      if (step.screen && parsedView.presentsTo.some((e) => e.destination === step.screen)) {
        return journey.id;
      }
    }
  }

  return "unassigned";
}

function ensureJourney(defs: WorkflowDefs, journeyId: string): Journey {
  let journey = defs.journeys.find((j) => j.id === journeyId);
  if (!journey) {
    journey = {
      id: journeyId,
      name: journeyId
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      description: "Auto-generated journey",
      steps: [],
    };
    defs.journeys.push(journey);
  }
  return journey;
}

/** Find which journey+step currently tracks a given swiftFile */
function findStepByFile(
  defs: WorkflowDefs,
  filePath: string
): { journey: Journey; step: Step } | null {
  for (const journey of defs.journeys) {
    for (const step of journey.steps) {
      if (step.swiftFile === filePath) return { journey, step };
    }
  }
  return null;
}

/** Build next[] from parsed edges, resolving destination view names to step IDs */
function resolveNext(parsedView: ParsedView, defs: WorkflowDefs): string[] {
  const nextIds: string[] = [];
  for (const edge of parsedView.presentsTo) {
    for (const journey of defs.journeys) {
      for (const step of journey.steps) {
        if (step.screen === edge.destination && !nextIds.includes(step.id)) {
          nextIds.push(step.id);
        }
      }
    }
  }
  return nextIds;
}

// ── Main merge ────────────────────────────────────────────────────

export function merge(
  current: WorkflowDefs,
  scanResult: ScanResult,
  parsedViews: ParsedView[]
): MergeResult {
  // Deep clone to avoid mutating input
  const defs: WorkflowDefs = JSON.parse(JSON.stringify(current));
  const changes: ChangeRecord[] = [];
  let reviewCount = 0;

  // Build lookup: structName → ParsedView
  const parsedByStruct = new Map<string, ParsedView>(
    parsedViews.map((p) => [p.structName, p])
  );
  const parsedByPath = new Map<string, ParsedView>(
    parsedViews.map((p) => [p.filePath, p])
  );

  // ── 1. New files ──────────────────────────────────────────────

  for (const file of scanResult.newFiles) {
    const parsed = parsedByPath.get(file.path);
    if (!parsed) continue; // couldn't parse struct name

    // Skip if a step already tracks this file
    if (findStepByFile(defs, file.path)) continue;

    const journeyId = assignJourney(file.path, parsed.structName, parsed, defs);
    const journey = ensureJourney(defs, journeyId);

    const stepId = slugify(parsed.structName);
    const next = resolveNext(parsed, defs);

    const step: Step = {
      id: stepId,
      label: `TODO: ${parsed.structName}`,
      screen: parsed.structName,
      swiftFile: file.path,
      type: parsed.inferredType,
      phase: "Unassigned",
      next,
      _needsReview: true,
    };

    journey.steps.push(step);
    reviewCount++;
    changes.push({
      action: "add",
      journeyId,
      stepId,
      detail: `Added ${parsed.structName} from ${file.path}`,
    });
  }

  // ── 2. Removed files ─────────────────────────────────────────

  for (const filePath of scanResult.removedFiles) {
    const found = findStepByFile(defs, filePath);
    if (!found) continue;

    if (!found.step.deprecated) {
      found.step.deprecated = true;
      changes.push({
        action: "deprecate",
        journeyId: found.journey.id,
        stepId: found.step.id,
        detail: `Marked deprecated (file removed: ${filePath})`,
      });
    }
  }

  // ── 3. Modified files ─────────────────────────────────────────

  for (const file of scanResult.modifiedFiles) {
    const parsed = parsedByPath.get(file.path);
    if (!parsed) continue;

    const found = findStepByFile(defs, file.path);
    if (!found) continue;

    const { step } = found;
    const newNext = resolveNext(parsed, defs);

    // Only update next if it actually changed; preserve edgeLabels
    const oldNextStr = JSON.stringify(step.next);
    const newNextStr = JSON.stringify(newNext);

    if (oldNextStr !== newNextStr) {
      // If next shrank, trim edgeLabels accordingly
      if (step.edgeLabels && newNext.length < step.edgeLabels.length) {
        step.edgeLabels = step.edgeLabels.slice(0, newNext.length);
      }
      step.next = newNext;
      changes.push({
        action: "update-edges",
        journeyId: found.journey.id,
        stepId: step.id,
        detail: `Updated next[] from ${oldNextStr} to ${newNextStr}`,
      });
    }
  }

  return { json: defs, changes, reviewCount };
}
