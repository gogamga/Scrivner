/**
 * export-mermaid.ts — Convert workflow-defs.json to Mermaid syntax for FigJam export.
 *
 * Usage:
 *   bun export-mermaid.ts              # Print Mermaid for all journeys
 *   bun export-mermaid.ts <journey-id> # Print Mermaid for one journey
 *   bun export-mermaid.ts --json       # Output JSON { journeyId: mermaid }
 */

import { join } from "path";

const DIR = import.meta.dir;
const WORKFLOWS_PATH = join(DIR, "workflow-defs.json");
const ANNOTATIONS_PATH = join(DIR, "annotations.json");

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

interface WorkflowDefs {
  version: string;
  generatedAt: string;
  journeys: Journey[];
}

interface Annotation {
  stepId: string;
  journeyId: string;
  type: string;
  text: string;
  priority: string;
  createdAt: string;
}

interface AnnotationsData {
  annotations: Annotation[];
}

// Mermaid shape by step type
function nodeShape(id: string, label: string, type: string): string {
  const escaped = label.replace(/"/g, "'");
  switch (type) {
    case "action":
      return `${id}["${escaped}"]`;
    case "display":
      return `${id}("${escaped}")`;
    case "decision":
      return `${id}{"${escaped}"}`;
    case "input":
      return `${id}[/"${escaped}"/]`;
    case "system":
      return `${id}[["${escaped}"]]`;
    default:
      return `${id}["${escaped}"]`;
  }
}

// Mermaid style class by step type
function styleClass(type: string): string {
  switch (type) {
    case "action":
      return "actionNode";
    case "display":
      return "displayNode";
    case "decision":
      return "decisionNode";
    case "input":
      return "inputNode";
    case "system":
      return "systemNode";
    default:
      return "";
  }
}

function journeyToMermaid(
  journey: Journey,
  annotations: Annotation[]
): string {
  const lines: string[] = [];
  lines.push(`flowchart LR`);

  // Track annotated steps for styling
  const annotatedSteps = new Set<string>();
  const changeRequestSteps = new Set<string>();
  const bugSteps = new Set<string>();

  for (const a of annotations) {
    if (a.journeyId === journey.id) {
      annotatedSteps.add(a.stepId);
      if (a.type === "change-request") changeRequestSteps.add(a.stepId);
      if (a.type === "bug") bugSteps.add(a.stepId);
    }
  }

  // Node definitions
  for (const step of journey.steps) {
    lines.push(`    ${nodeShape(step.id, step.label, step.type)}`);
  }

  lines.push("");

  // Edges (with optional labels)
  for (const step of journey.steps) {
    step.next.forEach((nextId, i) => {
      const label = step.edgeLabels?.[i];
      if (label) {
        const escaped = label.replace(/"/g, "'");
        lines.push(`    ${step.id} -->|"${escaped}"| ${nextId}`);
      } else {
        lines.push(`    ${step.id} --> ${nextId}`);
      }
    });
  }

  lines.push("");

  // Style classes
  lines.push(`    classDef actionNode fill:#34c759,color:#fff,stroke:#2da44e`);
  lines.push(`    classDef displayNode fill:#007aff,color:#fff,stroke:#0056cc`);
  lines.push(
    `    classDef decisionNode fill:#ff9500,color:#fff,stroke:#cc7a00`
  );
  lines.push(`    classDef inputNode fill:#af52de,color:#fff,stroke:#8b3db5`);
  lines.push(`    classDef systemNode fill:#8e8e93,color:#fff,stroke:#6d6d72`);
  lines.push(
    `    classDef annotatedNode stroke:#ff9500,stroke-width:3px,stroke-dasharray:5`
  );
  lines.push(
    `    classDef flaggedNode stroke:#ff3b30,stroke-width:3px`
  );

  // Apply type classes
  for (const step of journey.steps) {
    const cls = styleClass(step.type);
    if (cls) {
      lines.push(`    class ${step.id} ${cls}`);
    }
  }

  // Apply annotation styles (override type styles with border indicators)
  for (const stepId of bugSteps) {
    lines.push(`    class ${stepId} flaggedNode`);
  }
  for (const stepId of changeRequestSteps) {
    if (!bugSteps.has(stepId)) {
      lines.push(`    class ${stepId} flaggedNode`);
    }
  }

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const workflowsFile = Bun.file(WORKFLOWS_PATH);
  const annotationsFile = Bun.file(ANNOTATIONS_PATH);

  if (!(await workflowsFile.exists())) {
    console.error("workflow-defs.json not found");
    process.exit(1);
  }

  const workflows: WorkflowDefs = await workflowsFile.json();
  const annotationsData: AnnotationsData = (await annotationsFile.exists())
    ? await annotationsFile.json()
    : { annotations: [] };

  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const journeyId = args.find((a) => !a.startsWith("--"));

  if (journeyId) {
    const journey = workflows.journeys.find((j) => j.id === journeyId);
    if (!journey) {
      console.error(`Journey "${journeyId}" not found.`);
      console.error(
        `Available: ${workflows.journeys.map((j) => j.id).join(", ")}`
      );
      process.exit(1);
    }
    const mermaid = journeyToMermaid(journey, annotationsData.annotations);
    console.log(mermaid);
    return;
  }

  if (jsonMode) {
    const result: Record<string, string> = {};
    for (const journey of workflows.journeys) {
      result[journey.id] = journeyToMermaid(
        journey,
        annotationsData.annotations
      );
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Default: print all journeys
  for (const journey of workflows.journeys) {
    console.log(`\n=== ${journey.name} ===\n`);
    console.log(journeyToMermaid(journey, annotationsData.annotations));
  }
}

main();
