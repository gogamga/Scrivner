# Workflow Editor — Agent Context

## What This Is

Interactive node-graph editor for reviewing 11 user journeys in the ExampleApp iOS app. Runs locally via `bun --hot server.ts` on port 8091. Used by designers/developers to annotate workflow steps, export to Mermaid for FigJam, and generate review reports.

## Files

| File | Purpose |
|------|---------|
| `workflow-defs.json` | 11 journeys, ~100 steps, with `edgeLabels` on 14 multi-branch steps |
| `editor.tsx` | React app: FlowCanvas, StepNode, AnnotationPanel, zoom/pan/highlight logic |
| `editor.css` | All styles: nodes, connectors, zoom toolbar, hand mode, edge label pills |
| `editor.html` | HTML shell (imports editor.tsx + editor.css) |
| `server.ts` | Bun.serve() — serves HTML + REST API for workflows/annotations |
| `export-mermaid.ts` | CLI: converts journeys to Mermaid syntax with labeled edges |
| `review-annotations.ts` | CLI: generates prioritized annotation reports with branch info |
| `baseline.ts` | Baseline snapshot system (not modified in this session) |
| `annotations.json` | Persisted annotations (created at runtime) |

## Features Implemented (This Session)

### 1. Edge Labels on Decision Branches
- `edgeLabels?: string[]` added to Step interface (all 5 TS files)
- 14 multi-branch steps labeled in `workflow-defs.json`
- Rendered as white pill-shaped `<foreignObject>` at connector midpoints
- Fan offset for dense nodes (6+ edges, e.g. `detail-view`)
- Mermaid export uses `-->|"Label"|` syntax
- Review reports include `Branches:` line

### 2. Zoom
- CSS `transform: scale(zoom)` on `.flow-viewport` wrapper
- Buttons: +/- (15% step), percentage display (click to reset), Fit button
- Keyboard: Cmd+Plus, Cmd+Minus, Cmd+0 (reset), Shift+1 (fit)
- Wheel: Ctrl/Cmd+scroll (0.003 sensitivity)
- Range: 30% — 250%
- Toolbar position: bottom-right (per map-controls rubric)

### 3. Pan
- Space+left-click drag, middle-click drag, H key toggle (persistent hand mode)
- Arrow keys: 50px per press
- Native scroll wheel vertical, Shift+wheel horizontal
- Hand mode indicator badge when active
- Input guard: keyboard shortcuts skip when focus is in textarea/input/select

### 4. Floating Canvas + Auto-Center
- 600px padding on `.flow-viewport` creates infinite-canvas feel
- Auto-scrolls to center first step on load and journey switch
- Dot-grid background tiles seamlessly

### 5. Connection Highlighting
- Click a node: outgoing + incoming edges turn blue (#007aff), rest dim to 30% opacity
- Active edges get blue arrowhead marker, inactive get gray
- Edge label pills on inactive connectors also dim
- Deselect clears highlighting

### 6. Hover Polish
- Nodes: blue ring glow + border color shift on hover
- Zoom buttons: tooltips with keyboard shortcuts

## Key Constants (editor.tsx)

```
NODE_W=180, NODE_H=68, GAP_X=80, GAP_Y=56, COLS=5
CANVAS_PADDING=600
ZOOM_MIN=0.3, ZOOM_MAX=2.5, ZOOM_STEP=0.15
```

## Rubric Reference

`MapControls.md` — CSV rubric from Excalidraw/Miro/mind-map tools covering layout, hover, zoom, and pan conventions. All rows addressed.

## Running

```bash
cd figma/workflows
bun --hot server.ts        # http://localhost:8091
bun export-mermaid.ts      # all journeys to stdout
bun export-mermaid.ts first-launch  # single journey
bun review-annotations.ts  # annotation report
```

## What's NOT Done / Future Work

- Minimap for large canvases (rubric mentions it for zoomed-out views)
- Scroll-to-cursor zoom (currently zooms from top-left origin)
- Node dragging / repositioning
- WASD navigation (rubric says "rare", skipped intentionally)
- Trackpad pinch zoom (works via browser's Ctrl+wheel translation)
