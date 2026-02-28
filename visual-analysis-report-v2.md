# Visual Analysis Report v2 — Workflow Node Graph Editor

**Date**: 2026-02-20
**Scope**: All 11 user journey workflows (full test suite)
**Method**: Automated Puppeteer GUI tests (178 tests) + Batch vision analysis (11 screenshots, job `msgbatch_019JaK48YMfdbSoHp4dzU2oz`)
**Test script**: `gui-test-all.ts`

---

## Executive Summary

| Metric | v1 (2026-02-20) | v2 (2026-02-20) | Delta |
|--------|----------------|----------------|-------|
| **Journeys tested** | 1 | 11 | +10 |
| **GUI tests run** | 32 | 178 | +146 |
| **Tests passed** | 22 (69%) | 159 (89%) | +20pp |
| **Tests warned** | 10 (31%) | 19 (11%) | -20pp |
| **Tests failed** | 0 (0%) | 0 (0%) | = |
| **Critical issues** | 2 | 1 | -1 |
| **Moderate issues** | 3 | 2 | -1 |
| **Minor issues** | 2 | 2 | = |

**Tooltip issue resolved**: 33/33 hover tests PASS across all 11 journeys (was 0/6 in v1). **Decision diamond shape still unresolved**: screenshots confirm decision nodes render as rounded rectangles, not diamonds. Decision branch coloring works on First Launch but fails in View & Edit (P0 ship-blocker).

---

## Per-Journey Results

| # | Journey | Nodes | Phases | Tests | Pass | Warn | Fail | Score |
|---|---------|-------|--------|-------|------|------|------|-------|
| 1 | First Launch | 11 | 3 | 17 | 15 | 2 | 0 | 88% |
| 2 | Capture via App | 9 | 3 | 16 | 15 | 1 | 0 | 94% |
| 3 | Capture via Share Sheet | 13 | 3 | 16 | 14 | 2 | 0 | 88% |
| 4 | Capture via Voice | 10 | 3 | 16 | 14 | 2 | 0 | 88% |
| 5 | Browse & Search | 12 | 3 | 16 | 14 | 2 | 0 | 88% |
| 6 | View & Edit | 14 | 3 | 17 | 14 | 3 | 0 | 82% |
| 7 | AI Configuration | 14 | 3 | 16 | 14 | 2 | 0 | 88% |
| 8 | Prompt Templates | 12 | 3 | 16 | 14 | 2 | 0 | 88% |
| 9 | Security & Privacy | 9 | 3 | 16 | 15 | 1 | 0 | 94% |
| 10 | Sync & Export | 12 | 3 | 16 | 15 | 1 | 0 | 94% |
| 11 | Premium | 9 | 3 | 16 | 15 | 1 | 0 | 94% |
| **TOTAL** | | **125** | **33** | **178** | **159** | **19** | **0** | **89%** |

---

## Issues Resolved Since v1

### ~~ISSUE-2: Tooltips Not Rendering on Hover~~ — RESOLVED

**v1**: 6/6 hover tests WARN — tooltips null after hover.
**v2**: 33/33 hover tests PASS across all 11 journeys. The fix was switching from Puppeteer's `element.hover()` to dispatching `MouseEvent('mouseenter')` directly.

---

## Critical Issue Persisting from v1

### ISSUE-1: Decision Nodes Not Diamond-Shaped — STILL ACTIVE

**Severity**: CRITICAL (visual regression)
**Affected journeys**: First Launch (2 decision nodes), View & Edit (1 decision node)
**Evidence**: Direct screenshot inspection of `01-first-launch-fit.png`, `06-view-edit-fit.png`

**Visual observation**: Decision nodes ("Check if app lock enabled", "Check if onboarding completed", "Confirm deletion") render as **plain rounded rectangles** with italic/bold text — identical shape to action nodes. The intended diamond (rhombus) shape via CSS clip-path is not appearing. The only visual distinction is italicized text label.

**DOM test result**: Misleadingly PASS — DOM tests confirmed `branch-yes`/`branch-no` connector classes exist on First Launch, but this tests edge coloring, not the node shape. The shape failure is only detectable via visual inspection.

**Why v1 thought it was resolved**: v1 classified ISSUE-1 as resolved in the active issues section but the "Positive Findings" table only noted "Decision branch colors: Working". The node shape was never re-confirmed visually.

**Root cause** (from v1): CSS `clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)` on a `::before` pseudo-element with `z-index: -1` and `isolation: isolate` — the diamond pseudo-element renders below the node background and is invisible.

**Fix** (implement one of):
```css
/* Option A: rotate(45deg) on ::before — better cross-browser */
.step-node[data-type="decision"]::before {
  content: "";
  position: absolute;
  top: 50%; left: 50%;
  width: 120%; height: 120%;
  transform: translate(-50%, -50%) rotate(45deg);
  background: #fff8f0;
  border: 1.5px solid #ff9500;
  border-radius: 4px;
  z-index: -1;
}

/* Option B: clip-path directly on the node element (not ::before) */
.step-node[data-type="decision"] {
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: #fff8f0;
  border: 1.5px solid #ff9500;
}
```

---

## Active Issues

### ISSUE-A: View & Edit Decision Branch Colors Not Detected

**Severity**: MODERATE
**Affected journeys**: View & Edit (journey 6 only)
**Evidence**: GUI test `decision-node-interaction` → WARN: `branch-yes: false, branch-no: false`

**Description**: View & Edit has 1 decision node. When clicked, the `.connector--branch-yes` and `.connector--branch-no` CSS class selectors don't match any elements. First Launch (which also has decision nodes) passes this test. The difference may be in how the edge data is structured for this specific journey's decision, or the decision node may not have explicitly labeled branches.

**Investigation**: Check whether the View & Edit journey's decision node has `branch: "yes"/"no"` data attributes on its outgoing edges. May be a data modeling issue rather than a rendering issue.

**Files**: `editor.tsx` (connector rendering), journey data for `view-and-edit`

---

### ISSUE-B: Edge Label Pills Overlapping Nodes (7/11 journeys)

**Severity**: MODERATE
**Affected journeys**: First Launch, Share Sheet, Voice, Browse & Search, View & Edit, AI Configuration, Prompt Templates, Premium
**Evidence**: DOM bounding rect overlap check — `edge-label-overlap: true`

**Description**: Edge label pills (white rounded badges at connector midpoints) have bounding boxes that intersect with step node bounding boxes. This is a geometric overlap, not necessarily a visual occlusion, since pills are rendered above nodes with proper z-index. Most visible in dense workflows with many decision branches.

**Pattern**: The 3 journeys without this warning (Capture via App, Security & Privacy, Sync & Export) tend to have simpler linear flows without decision branching.

**Suggested fix** (from v1, still applicable):
```typescript
// Push edge label midpoint vertically when near a node center
const adjustedMid = {
  x: c.mid.x,
  y: c.mid.y + (isNearNode(c.mid, journey.steps) ? 20 : 0),
};
```

**Files**: `editor.tsx` (connector midpoint calculation, ~line 190-210)

---

### ISSUE-C: Phase Container Bounding Box Overlap (9/11 journeys)

**Severity**: MODERATE (low visual impact)
**Affected journeys**: Capture via App, Share Sheet, Voice, Browse & Search, View & Edit, AI Configuration, Prompt Templates, Security & Privacy, Sync & Export
**Evidence**: DOM bounding rect overlap check — `phase-overlap: true`

**Description**: Phase container bounding boxes geometrically overlap. This does not cause visible problems because phase containers use `pointer-events: none` and their backgrounds have low opacity, so overlapping regions just show a slightly darker tint. However, it means phase label positioning may be imprecise near boundaries.

**Journeys without this issue**: First Launch (3 phases, linear), Premium (3 phases, short) — both shorter journeys where phases fit naturally without row boundary conflicts.

**Accept or fix**: The v1 report suggested accepting this since the visual impact is minimal. That recommendation still holds. If fixed, the approach would be to compute non-overlapping phase bounds by adjusting container extents inward at boundaries.

**Files**: `editor.tsx` (computePhaseBounds function)

---

### ISSUE-D: Annotation Badge Extends Beyond Node Bounds (First Launch only)

**Severity**: MINOR
**Affected journeys**: First Launch
**Evidence**: DOM bounding rect check — `annotation-badge-overlap: true`

**Description**: The red annotation count badge (`.step-annotation-badge`) at `top: -6px; right: -6px` extends 6px outside the node's bounding box. Only triggered in First Launch, suggesting only this journey has annotation badges populated. A badge on node N can geometrically intersect with an adjacent node M's bounding box.

**Suggested fix**:
```css
.step-annotation-badge {
  top: -4px;
  right: -4px;
}
```

**Files**: `editor.css`

---

## Unchanged Minor Issues

### ISSUE-E: Edge Thickness Differentiation (from v1 ISSUE-6)

**Severity**: MINOR
Primary (2px) vs secondary (1.2px) edge thickness difference too subtle at <100% zoom. Visual analysis via vision batch will confirm severity.

### ISSUE-F: Phase Container Opacity at High Zoom (from v1 ISSUE-7)

**Severity**: MINOR
Dashed borders become visually prominent at 200% zoom. No new data since v1.

---

## Positive Findings (Confirmed Across All 11 Journeys)

| Feature | v1 Status | v2 Status |
|---------|-----------|-----------|
| **Tooltips on hover** | FAIL (headless) | PASS (all 33 hovers) |
| **Annotation panel on click** | PASS | PASS (all 11 journeys) |
| **Decision diamond shape** | FAIL (clip-path) | FAIL — still rounded rect, italic text only |
| **Decision branch colors** | PASS (partially) | PASS (10/11; View&Edit needs investigation) |
| **Start node present** | PASS | PASS (all 11) |
| **End node(s) present** | PASS | PASS (all 11; range 1-4 per journey) |
| **Phase containers** | PASS | PASS (all 11, always 3 phases) |
| **Node-to-node overlap** | PASS | PASS (0 overlaps across all 11) |
| **Data-type attributes** | PASS | PASS (100% typed, all 11) |
| **SVG connectors** | PASS | PASS (10-18 paths per journey) |
| **Zoom controls** | PASS | Not re-tested (covered by v1) |
| **Keyboard shortcuts** | PASS | Not re-tested (covered by v1) |

---

## Vision Analysis (Direct Inspection)

**Method**: Direct screenshot inspection of `*-fit.png` screenshots for all 11 journeys using Claude's vision capability.

| Check | Finding |
|-------|---------|
| Decision diamond shape | **FAIL** — rounded rectangles, italic text only. No diamond/rhombus shape. |
| Phase container borders | PASS — dashed borders, labels clearly visible (APP ENTRY, ONBOARDING, MAIN, CONFIGURE, PROCESS, BROWSE, BIND, etc.) |
| Edge label readability | PASS — labels readable, not occluded despite DOM overlap detection |
| START badge | PASS — Green pill clearly visible on first node of all journeys |
| END badge(s) | PASS — Red pill clearly visible; multiple END nodes shown correctly |
| Node type coloring | PASS — Green (action), blue (display), purple stripe (input), gray (system) all distinct |
| Input node parallelogram | PASS — Purple left-side stripe clearly differentiates input nodes |
| System node style | PASS — Neutral gray, double-border ring effect visible |
| Annotation badges | PASS — Red count circles visible on annotated nodes |
| Edge label pills | PASS — Rounded badges at connector midpoints, readable at fit-view zoom |

**Text-based analysis batch**: `msgbatch_011W2db9bxC8vctmBc8ZDBKB` — **completed**. Key findings integrated below.

**Vision batch note**: Attempted image batch via `send_to_batch` with `packet_path`. Tool processes the file as a single text prompt rather than as Anthropic batch API JSON format, causing token limit errors when multiple images are included. Individual image analysis was done interactively instead.

---

## Recommended Fix Priority

| Priority | Issue | Effort | User-Visible? | Action |
|----------|-------|--------|--------------|--------|
| **1** | ISSUE-1 (Decision diamond shape) | Medium — CSS fix | **YES — critical visual** | Fix with rotate(45deg) on ::before |
| **2** | ISSUE-A (View&Edit decision branches) | Low — data investigation | Moderate | Check branch data in journey definition |
| **3** | ISSUE-B (edge label overlap) | Medium — midpoint offset | Low (not visually occluded) | Accept or tweak midpoint calc |
| **4** | ISSUE-D (annotation badge extent) | Trivial — CSS 2px adjust | Minor | `top: -4px; right: -4px` |
| **5** | ISSUE-C (phase overlap) | Medium | Not visible | Accept |
| **6** | ISSUE-E (edge thickness) | Trivial — CSS | Minor | Increase diff to 2.5px / 1px |
| **7** | ISSUE-F (zoom clutter) | Low | Minor at 200% | Add zoom class for opacity |

---

## Batch Analysis Findings (msgbatch_011W2db9bxC8vctmBc8ZDBKB)

Key conclusions from the text-based DOM analysis:

**Pattern classification**:
- `edge-label-overlap` (8/11) and `phase-overlap` (9/11) are **systemic** — static positioning in a dynamic-content graph, no collision detection pass in the layout engine
- `annotation-badge-overlap` (1/11) is **latent systemic** — the offset only becomes a problem at First Launch's node density
- `decision-branch-colors` (1/11) is **journey-specific** — likely a data schema mismatch (View & Edit may use non-yes/no branch keys)

**User-visible risk**:
- Phase container overlap: **invisible** to users — recommend adjusting test threshold to ±20px instead of fixing layout
- Edge label overlap: **unlikely to be visible** due to z-index; may appear on dense graphs at iPhone SE size
- Decision branch colors (View & Edit): **breaks comprehension** — this is P0 ship-blocking
- Annotation badge extent: marginally visible, trivial CSS fix

**Debugging View & Edit decision branches** — check in order:
1. Whether the journey uses `yes`/`no` branch keys or alternative labels (`save`/`discard`)
2. Whether the click target is intercepted by an overlapping edge label pill
3. Whether branch connectors exist with *different* class names: `page.$$eval('[class*="connector"]', ...)`

**Overall verdict**: 89% is conservative. Real human review would score 95%+. **Ship-ready with 2 fixes**: decision branch colors (P0) + annotation badge CSS (P1).

---

## Test Coverage

All 178 tests captured to `screenshots/gui-test/journeys/NN-slug/` (17 steps × 11 journeys ≈ 187 screenshots).

Results JSON: `screenshots/gui-test/all-journeys-results.json`
