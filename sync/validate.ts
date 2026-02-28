/**
 * sync/validate.ts — Pure structural validator for WorkflowDefs.
 *
 * Returns { ok: boolean; errors: string[] }
 */

import type { WorkflowDefs, Journey, Step } from "./merge";

const VALID_TYPES = new Set(["action", "display", "decision", "input", "system"]);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validate(
  current: WorkflowDefs,
  incoming: WorkflowDefs
): ValidationResult {
  const errors: string[] = [];

  // 1. Has journeys array
  if (!Array.isArray(incoming.journeys)) {
    errors.push("Missing or invalid journeys array");
    return { ok: false, errors };
  }

  // 2. Journey count delta bounded: +3 / -1
  const currCount = (current.journeys || []).length;
  const newCount = incoming.journeys.length;
  const delta = newCount - currCount;
  if (delta > 3) {
    errors.push(`Too many journeys added in one cycle: +${delta} (max +3)`);
  }
  if (delta < -1) {
    errors.push(`Too many journeys removed in one cycle: ${delta} (max -1)`);
  }

  // Build set of non-deprecated step IDs from current defs
  const currentStepIds = new Set<string>();
  for (const journey of current.journeys || []) {
    for (const step of journey.steps || []) {
      if (!step.deprecated) {
        currentStepIds.add(`${journey.id}::${step.id}`);
      }
    }
  }

  // Track global step IDs for uniqueness check
  const globalStepIds = new Set<string>();

  for (const journey of incoming.journeys) {
    const jPrefix = `Journey "${journey.id}"`;

    // 3. Each journey has required fields
    if (!journey.id) errors.push("Journey missing id");
    if (!journey.name) errors.push(`${jPrefix}: missing name`);
    if (typeof journey.description !== "string") errors.push(`${jPrefix}: missing description`);
    if (!Array.isArray(journey.steps)) {
      errors.push(`${jPrefix}: missing steps array`);
      continue;
    }

    // Build step ID set for this journey (for next[] ref checks)
    const journeyStepIds = new Set(journey.steps.map((s) => s.id));

    for (const step of journey.steps) {
      const sPrefix = `${jPrefix} step "${step.id}"`;

      // 4. Each step has required fields
      if (!step.id) { errors.push(`${jPrefix}: step missing id`); continue; }
      if (!step.label) errors.push(`${sPrefix}: missing label`);
      if (!step.screen) errors.push(`${sPrefix}: missing screen`);
      if (step.swiftFile === undefined) errors.push(`${sPrefix}: missing swiftFile`);
      if (!step.type) errors.push(`${sPrefix}: missing type`);
      if (!Array.isArray(step.next)) errors.push(`${sPrefix}: missing next array`);

      // 5. Type must be valid
      if (step.type && !VALID_TYPES.has(step.type)) {
        errors.push(`${sPrefix}: invalid type "${step.type}"`);
      }

      // 6. Step IDs unique per journey
      const globalKey = `${journey.id}::${step.id}`;
      if (globalStepIds.has(globalKey)) {
        errors.push(`${sPrefix}: duplicate step ID in journey "${journey.id}"`);
      } else {
        globalStepIds.add(globalKey);
      }

      // 7. next[] refs must exist within the same journey
      if (Array.isArray(step.next)) {
        for (const nextId of step.next) {
          if (!journeyStepIds.has(nextId)) {
            errors.push(`${sPrefix}: next ref "${nextId}" not found in journey`);
          }
        }
      }

      // 8. Non-deprecated step IDs from current must not be removed
      if (currentStepIds.has(globalKey) && step.deprecated) {
        // It's OK to deprecate — that's our soft-delete mechanism
      }
    }

    // 9. Check that no non-deprecated current step IDs are fully gone
    for (const key of currentStepIds) {
      if (key.startsWith(journey.id + "::")) {
        const stepId = key.slice(journey.id.length + 2);
        if (!journeyStepIds.has(stepId)) {
          errors.push(`Journey "${journey.id}": step "${stepId}" was removed (use deprecated:true instead)`);
        }
      }
    }
  }

  // Check that no entire current journeys are gone without accounting for delta
  const incomingJourneyIds = new Set(incoming.journeys.map((j) => j.id));
  for (const journey of current.journeys || []) {
    if (!incomingJourneyIds.has(journey.id)) {
      // A journey being removed is captured by the delta check above
    }
  }

  return { ok: errors.length === 0, errors };
}
