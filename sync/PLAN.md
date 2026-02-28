# Woviz Auto-Sync — Build Plan

## Overview

Background daemon that polls the companion app's git repo for UI Swift file changes, updates `workflow-defs.json` via deterministic script (no LLM in hot path). Optional LLM polish on-demand.

## Existing Files (read before integrating)

- `server.ts` — Bun.serve() port 8091, GET/PUT /api/workflows, GET/POST /api/annotations, HMR
- `workflow-defs.json` — 11 journeys, 125 steps. Step shape: `{ id, label, screen, swiftFile, type, phase, next, edgeLabels? }`
- `baseline.ts` — save/diff subcommands for snapshots
- `export-mermaid.ts` — CLI converts journeys to Mermaid syntax
- `editor.tsx` — React app, fetches /api/workflows on load

## Watched Directories (relative to app repo root)

- `ExampleApp/Sources/UI/Views/*.swift`
- `ExampleApp/Sources/UI/Onboarding/*.swift`
- `ExampleApp/Sources/UI/Components/*.swift` (only if nav patterns found)
- `ExampleApp/ContentView.swift`, `ExampleApp/ExampleAppApp.swift`
- `ExampleAppShare/*.swift`, `ExampleAppAction/*.swift`

## Files to Build (in order)

### 1. `lib/logger.ts` (~80 lines)

NDJSON logger → `logs/woviz-daemon.log` + stdout. 5MB rotation (keep 2). ERROR also → `logs/woviz-errors.log`.

Fields: `ts, event, severity, commit?, files?, changes?, pendingReview?, durationMs?, error?`

Events: POLL_TICK, COMMIT_DETECTED, SCAN_COMPLETE, MERGE_APPLIED, UPDATE_SKIPPED, VALIDATION_FAILED, ERROR, DAEMON_START, DAEMON_STOP

### 2. `sync/parse.ts` (~120 lines)

Pure function. Input: file path + content string. Output:

```typescript
interface ParsedView {
  structName: string;             // from `struct (\w+)\s*:\s*View`
  filePath: string;
  presentsTo: { destination: string; mechanism: string }[];
  inferredType: "action" | "display" | "decision" | "input" | "system";
}
```

Nav extraction regexes:
- `.sheet(...) { FooView(` → FooView, sheet
- `NavigationLink { FooView(` → FooView, navigationLink
- `.navigationDestination(...) { FooView(` → FooView, navigationDestination
- `.fullScreenCover(...) { FooView(` → FooView, fullScreenCover
- TabView children → tabView

Type heuristics: TextField/TextEditor/Picker/Toggle → input, Button/dismiss as primary → action, conditional nav → decision, background-only → system, default → display.

### 3. `sync/scan.ts` (~80 lines)

File inventory via `Bun.$` git commands. Input: app repo path, last SHA, current workflow-defs. Output:

```typescript
interface ScanResult {
  newFiles: { path: string; content: string; diff: string; status: "A"|"M"|"D" }[];
  removedFiles: string[];
  modifiedFiles: { path: string; content: string; diff: string; status: "A"|"M"|"D" }[];
}
```

Git commands: `rev-parse HEAD`, `diff <old>..HEAD --name-status -- "*.swift"`, `diff <old>..HEAD -- <file>`, `Bun.file()` for content.

### 4. `sync/merge.ts` (~150 lines)

Pure function. Input: current WorkflowDefs + ScanResult + ParsedView[]. Output:

```typescript
interface MergeResult {
  json: WorkflowDefs;
  changes: { action: string; journeyId: string; stepId: string; detail: string }[];
  reviewCount: number;
}
```

**New files:** screen=structName, id=slugified, swiftFile=path, type from heuristic, phase="Unassigned", label="TODO: \<Name\>", `_needsReview: true`. Journey: Onboarding/→first-launch, ExampleAppShare/→capture-via-share, ExampleAppAction/→capture-via-action, presented-by-existing→same journey, else→new unassigned journey. next[] from parsed edges.

**Removed files:** Add `deprecated: true`. Never delete steps.

**Modified files:** Re-parse edges, update next[]. Preserve existing edgeLabels.

### 5. `sync/validate.ts` (~80 lines)

Pure function. Returns `{ ok: boolean; errors: string[] }`.

Checks: has journeys[], each journey has id/name/description/steps[], each step has id/label/screen/swiftFile/type/next, type valid, step IDs unique per journey, next[] refs exist, no non-deprecated IDs removed, journey count Δ bounded +3/−1.

### 6. `sync/sync.test.ts` (~250 lines)

Tier 1 (unit): parse.ts patterns + type inference, merge.ts add/deprecate/update rules, validate.ts pass/fail cases.

Tier 2 (integration): temp git repo with Swift fixtures → full pipeline → assert JSON correct.

### 7. `daemon.ts` (~120 lines)

Entry point. Imports/extends server.ts. Starts poll loop.

- State persisted in `sync/.last-commit` (survives restarts)
- Every POLL_INTERVAL: git HEAD check → scan → parse → merge → validate → baseline save → write → export-mermaid
- Adds `GET /api/daemon/status` → `{ status, lastCommit, lastCheck, lastUpdate, pollInterval, updatesApplied, pendingReview, consecutiveErrors }`
- Error handling: git fail → skip cycle, validation fail → discard, write fail → log + continue, 5 consecutive errors → pause 10min

### 8. Add `restore` to `baseline.ts` (+30 lines)

`bun baseline.ts restore [timestamp]` — copy snapshot back to workflow-defs.json.

### 9. `.env.example`

```
APP_REPO_PATH=/path/to/your/app/repo
POLL_INTERVAL_SECONDS=60
WOVIZ_PORT=8091
LOG_MAX_BYTES=5242880
```

### 10. `sync/polish.ts` (~100 lines, OPTIONAL, last)

On-demand only: `bun polish.ts [--dry-run] [--journey <id>]`. Finds `_needsReview` steps, sends tiny prompt to Sonnet 4.6 per step (~430 tokens each, ~$0.002/screen). Requires `@anthropic-ai/sdk`. Removes flag after polishing.

## Constraints

- Bun only. `Bun.$` for shell, `Bun.file()` for I/O. No new deps for steps 1-9.
- Build incrementally. Test each file before moving on.
- Read existing files before modifying or integrating.
- Don't refactor existing files beyond integration needs.
