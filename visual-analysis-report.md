# Visual Analysis Report — Workflow Node Graph Editor

**Date**: 2026-02-20
**Scope**: All 11 user journey workflows + interactive states
**Method**: Automated Puppeteer screenshots (70 captures) + GUI test pilot (32 tests) + AI vision analysis (4 parallel agents)

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Screenshots captured** | 70 |
| **GUI tests run** | 32 |
| **Tests passed** | 22 (69%) |
| **Tests warned** | 10 (31%) |
| **Tests failed** | 0 (0%) |
| **Critical issues** | 2 |
| **Moderate issues** | 3 |
| **Minor issues** | 2 |

Overall the implementation is solid. Phase containers, start/end nodes, edge styling, and visual hierarchy are working well. Two critical issues need attention: **decision diamond shape not rendering** and **tooltips not appearing on hover**.

---

## Critical Issues

### ISSUE-1: Decision Nodes Not Rendering as Diamonds

**Severity**: CRITICAL
**Affected journeys**: All journeys with decision nodes (first-launch, capture-via-share, view-and-edit, security-and-privacy)
**Evidence**: Screenshots `01-first-launch-full.png`, `06-view---edit-fit.png`, `dense-zoomed-150.png`

**Description**: Decision-type nodes render as rounded rectangles identical to action nodes, despite the CSS `clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)` being defined. The diamond `::before` pseudo-element is not visually appearing in the rendered output. The decision nodes are correctly sized at 200x80px (confirmed by GUI test), and `data-type="decision"` is present on the DOM, but the diamond shape is not visible.

**Root cause hypothesis**: The `::before` pseudo-element with `clip-path` and `z-index: -1` combined with `isolation: isolate` may have a rendering issue in Chromium's headless mode, or the `inset: -14px` positioning may be causing the diamond to render outside the visible bounds of the parent. Alternatively, the `background: transparent` on the node itself with `border-color: transparent` may be removing the rectangular visual but the `::before` diamond may not be receiving proper paint.

**Suggested fix**:
```css
/* Option A: Use CSS transform instead of clip-path for better compatibility */
.step-node[data-type="decision"] {
  background: transparent;
  border: none;
  width: 200px;
  min-height: 80px;
  overflow: visible;
}

.step-node[data-type="decision"]::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 140%;
  height: 140%;
  transform: translate(-50%, -50%) rotate(45deg);
  background: #fff;
  border: 1.5px solid #ff9500;
  border-radius: 4px;
  z-index: -1;
}

/* Option B: Apply clip-path directly to the node, not a pseudo-element */
.step-node[data-type="decision"] {
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: #fff;
  border: 1.5px solid #ff9500;
  width: 220px;
  min-height: 90px;
  padding: 20px 30px;
}
```

**Files**: `editor.css` (lines 451-495)

---

### ISSUE-2: Tooltips Not Rendering on Hover

**Severity**: CRITICAL
**Affected journeys**: All
**Evidence**: All hover screenshots (`*-hover-0.png`, `*-hover-1.png`, `*-hover-2.png`), GUI test results (6/6 hover tests WARN)

**Description**: Despite the tooltip implementation being present in `editor.tsx` (state, handlers, JSX rendering), no tooltips appear when hovering over nodes. The GUI test confirms `document.querySelector('.step-tooltip')` returns null after hovering and waiting 500ms (beyond the 400ms delay).

**Root cause hypothesis**: Puppeteer's `element.hover()` may not properly trigger React's `onMouseEnter` event on the `.step-node` div. In headless Chromium, hover may dispatch `mouseover` but not `mouseenter`. Alternatively, the `pointer-events: none` on phase containers may be intercepting the hover before it reaches nodes. Another possibility: the zoom transform on `.flow-viewport` may be affecting event coordinate calculation, causing `getBoundingClientRect()` to return incorrect values for tooltip positioning.

**Suggested fix**:
```typescript
// In capture-screenshots.ts / gui-test-pilot.ts — use page.evaluate to dispatch
// mouseenter directly instead of Puppeteer hover():
await page.evaluate((selector) => {
  const el = document.querySelector(selector);
  if (el) {
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  }
}, `.step-node:nth-child(${n + 1})`);

// Also verify in editor.tsx that the tooltip renders inside the .app div
// (not inside .flow-viewport which has transform: scale), and uses
// position: fixed coordinates from getBoundingClientRect()
```

**Note**: This may be purely a test harness issue, not a production bug. Verify manually in a real browser before modifying the tooltip implementation.

**Files**: `editor.tsx` (lines 830-846, 961-999), `gui-test-pilot.ts`

---

## Moderate Issues

### ISSUE-3: Edge Labels Overlapping Nodes

**Severity**: MODERATE
**Affected journeys**: first-launch, capture-via-share, view-and-edit (dense workflows)
**Evidence**: GUI test `edge-label-overlap` (WARN), vision analysis of `06-view---edit-full.png`

**Description**: Edge label pills (white rounded badges at connector midpoints) occasionally overlap with node bounding boxes. This is most visible in dense workflows where connectors run close to nodes. The overlap is geometric (bounding boxes intersect) but doesn't necessarily obscure content due to the pills' small size.

**Suggested fix**:
```typescript
// In editor.tsx, adjust edge label midpoint calculation to push labels away from nodes
// Add a vertical offset to labels when they're within NODE_H/2 of a node center
const adjustedMid = {
  x: c.mid.x,
  y: c.mid.y + (isNearNode(c.mid, journey.steps) ? 20 : 0),
};
```

**Files**: `editor.tsx` (connector midpoint calculation, ~line 190-210)

---

### ISSUE-4: Phase Containers Overlapping Each Other

**Severity**: MODERATE
**Affected journeys**: first-launch (confirmed by GUI test)
**Evidence**: GUI test `phase-overlap-check` (WARN)

**Description**: Phase container bounding boxes overlap when steps from adjacent phases occupy the same row in the 5-column grid. For example, if "App Entry" has 5 steps (filling row 1) and "Onboarding" starts at step 6 (row 2, col 1), the phase container padding can cause overlap on the row boundary.

**Suggested fix**:
```typescript
// In editor.tsx computePhaseBounds(), add inter-phase gap
const PHASE_GAP = 12; // pixels between adjacent phases

// After computing all bounds, detect overlaps and push down
for (let i = 1; i < phaseBounds.length; i++) {
  const prev = phaseBounds[i - 1];
  const curr = phaseBounds[i];
  const prevBottom = prev.y + prev.height;
  if (curr.y < prevBottom + PHASE_GAP) {
    // Don't move nodes, just shrink container to avoid overlap
    curr.height -= (prevBottom + PHASE_GAP - curr.y);
    curr.y = prevBottom + PHASE_GAP;
  }
}
```

**Alternative**: Accept the overlap since phase containers use `pointer-events: none` and don't interfere with interaction. The visual overlap is subtle due to low-opacity backgrounds.

**Files**: `editor.tsx` (computePhaseBounds function)

---

### ISSUE-5: Annotation Badges Overlapping Adjacent Nodes

**Severity**: MODERATE
**Affected journeys**: Any journey with annotations on adjacent nodes
**Evidence**: GUI test `overlap-annotation-badges-vs-nodes` (WARN)

**Description**: The `.step-annotation-badge` (red count circle) is positioned at `top: -6px; right: -6px` on nodes, which extends beyond the node bounding box. When two nodes are vertically adjacent, the badge of the upper node can visually overlap the lower node.

**Suggested fix**:
```css
/* Move badge slightly inward to stay within node bounds */
.step-annotation-badge {
  top: -4px;
  right: -4px;
  /* Or use a smaller badge size */
  width: 16px;
  height: 16px;
  font-size: 9px;
}
```

**Files**: `editor.css` (`.step-annotation-badge` rule)

---

## Minor Issues

### ISSUE-6: Edge Thickness Differentiation Not Clearly Visible

**Severity**: MINOR
**Evidence**: Vision analysis of connector screenshots

**Description**: The primary (2px) vs secondary (1.2px) edge thickness difference is too subtle to notice visually, especially at zoom levels below 100%. The design guidance calls for "varying thickness for emphasis."

**Suggested fix**:
```css
/* Increase thickness differential */
.flow-svg path.connector--primary { stroke-width: 2.5; }
.flow-svg path.connector--secondary { stroke-width: 1; }

/* Active state */
.flow-svg path.connector-active.connector--primary { stroke-width: 3.5; }
.flow-svg path.connector-active.connector--secondary { stroke-width: 1.5; }
```

**Files**: `editor.css`

---

### ISSUE-7: Phase Container Visual Clutter at High Zoom

**Severity**: MINOR
**Evidence**: `dense-zoomed-200.png`

**Description**: At 200% zoom, the dashed phase container borders become visually prominent and add clutter to the already dense view. The design guidance suggests containers should be "collapsible in interactive tools."

**Suggested fix**: Add a CSS media query or zoom-level check that reduces phase container opacity at high zoom:
```css
/* In editor.tsx, conditionally apply a class based on zoom level */
/* When zoom > 1.5, add .zoom-dense class to .flow-viewport */
.zoom-dense .phase-container {
  opacity: 0.3;
  border-width: 1px;
}
```

**Files**: `editor.tsx` (zoom state), `editor.css`

---

## Positive Findings

The following design guidance elements are working correctly:

| Feature | Status | Notes |
|---------|--------|-------|
| **Start/End node pills** | Working | Green START badge, red END badge, correct positioning |
| **Start/End node sizing** | Correct | 200x80px decision nodes, pill-shaped start/end |
| **Phase containers** | Working | 3 phases per journey, dashed borders, type-tinted backgrounds |
| **Phase labels & counts** | Working | Top-left labels, top-right step counts |
| **Node type coloring** | Excellent | Consistent 5-color palette across all 11 journeys |
| **Input parallelogram** | Working | `skewX(-8deg)` shape clearly visible |
| **System double border** | Working | Ring + gap border effect visible |
| **Edge dashing** | Working | Decision outgoing edges show `6 4` dash pattern |
| **Branch coloring** | Working | Green/red branch colors on decision selection |
| **Flow animation** | Present | `stroke-dasharray: 10 5` with animation on active edges |
| **Visual hierarchy shadows** | Working | 4-tier elevation visible across node types |
| **Connection highlighting** | Working | Blue active edges, dimmed inactive edges |
| **Annotation panel** | Working | All step details displayed correctly |
| **Zoom controls** | Working | All keyboard shortcuts and toolbar buttons functional |
| **Pan controls** | Working | Space+drag, middle-click, arrow keys all functional |
| **Node-to-node overlap** | None | Zero overlap between nodes (confirmed by DOM check) |

---

## Test Matrix

### GUI Test Results (32 tests)

| Test | Status | Observation |
|------|--------|-------------|
| initial-load | PASS | 11 journeys loaded, first selected |
| first-journey-name | PASS | "First Launch" correct |
| step-nodes-count | PASS | 11/11 nodes rendered |
| start-node | PASS | START badge present |
| end-nodes | PASS | 1 end node found |
| phase-containers | PASS | 3 containers: App Entry, Onboarding, Main |
| node-overlap-check | PASS | No node-to-node overlap |
| edge-label-overlap | WARN | Edge labels overlap nodes |
| phase-overlap-check | WARN | Phase containers overlap |
| start-badge-clipping | PASS | No clipping (710px from top) |
| hover-node-0 through 5 | WARN x6 | Tooltips not visible in headless mode |
| click-node-0 through 5 panels | PASS x6 | All panels open correctly |
| decision-node-interaction | PASS | 200x80px, branch-yes + branch-no present |
| zoom-in | PASS | 115% correct |
| zoom-fit | PASS | 55% correct |
| data-type-attributes | PASS | 11/11 nodes typed |
| svg-connectors | PASS | 14 paths rendered |
| edge-label-pills | PASS | 4 pills rendered |
| overlap-start-badge-vs-nodes | WARN | Pseudo-element, needs visual check |
| overlap-phase-labels-vs-nodes | PASS | No overlap |
| overlap-edge-labels-vs-edge-labels | PASS | No overlap |
| overlap-annotation-badges-vs-nodes | WARN | Badges extend beyond node bounds |

---

## Recommended Fix Priority

1. **ISSUE-1** (Decision diamonds) — Fix first, highest visual impact
2. **ISSUE-2** (Tooltips) — Investigate if browser-only or test issue
3. **ISSUE-3** (Edge label overlap) — Moderate impact, affects dense workflows
4. **ISSUE-4** (Phase overlap) — Low visual impact due to transparent backgrounds
5. **ISSUE-5** (Badge overlap) — Low impact, only visible with annotations
6. **ISSUE-6** (Edge thickness) — CSS-only tweak
7. **ISSUE-7** (Zoom clutter) — Enhancement, not a bug
