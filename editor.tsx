import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";

// ── Types ────────────────────────────────────────────────────────────
interface Step {
  id: string;
  label: string;
  screen: string;
  swiftFile: string;
  type: "action" | "display" | "decision" | "input" | "system";
  next: string[];
  edgeLabels?: string[];
  phase?: string;
}

interface Journey {
  id: string;
  name: string;
  description: string;
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

// ── Constants ────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  action: "#34c759",
  display: "#007aff",
  decision: "#ff9500",
  input: "#af52de",
  system: "#8e8e93",
};

const TYPE_LABELS: Record<string, string> = {
  action: "Action",
  display: "Display",
  decision: "Decision",
  input: "Input",
  system: "System",
};

const NODE_W = 180;
const NODE_H = 68;
const GAP_X = 80;
const GAP_Y = 56;
const COLS = 5;
const CANVAS_PADDING = 600;

// Phase container layout constants
const PHASE_PADDING = 16;
const PHASE_LABEL_HEIGHT = 24;

// ── Position helpers ─────────────────────────────────────────────────
function stepPosition(index: number) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return { x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) };
}

function canvasSize(stepCount: number) {
  const rows = Math.ceil(stepCount / COLS);
  const cols = Math.min(stepCount, COLS);
  return {
    w: cols * (NODE_W + GAP_X) - GAP_X + 60,
    h: rows * (NODE_H + GAP_Y) - GAP_Y + 60,
  };
}

function scrollToCenter(
  canvasEl: HTMLDivElement,
  stepIdx: number,
  zoom: number,
) {
  const pos = stepPosition(stepIdx);
  const targetX = (CANVAS_PADDING + pos.x + NODE_W / 2) * zoom;
  const targetY = (CANVAS_PADDING + pos.y + NODE_H / 2) * zoom;
  const viewW = canvasEl.clientWidth;
  const viewH = canvasEl.clientHeight;
  canvasEl.scrollLeft = targetX - viewW / 2;
  canvasEl.scrollTop = targetY - viewH / 2;
}

// ── Connector midpoint ──────────────────────────────────────────────
function connectorMidpoint(
  fromIdx: number,
  toIdx: number,
  edgeOffset: number = 0,
): { x: number; y: number } {
  const from = stepPosition(fromIdx);
  const to = stepPosition(toIdx);
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 + edgeOffset };
}

// ── SVG connector path ──────────────────────────────────────────────
function connectorPath(
  fromIdx: number,
  toIdx: number,
): string {
  const from = stepPosition(fromIdx);
  const to = stepPosition(toIdx);

  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;

  // Same row: simple horizontal curve
  if (Math.abs(y1 - y2) < 5) {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  // Next row wrap-around: route down and left
  if (to.x < from.x) {
    const dropY = from.y + NODE_H + 16;
    const riseY = to.y - 16;
    return `M${x1},${y1} L${x1 + 20},${y1} Q${x1 + 28},${y1} ${x1 + 28},${y1 + 8} L${x1 + 28},${dropY} Q${x1 + 28},${dropY + 8} ${x1 + 20},${dropY + 8} L${x2 - 20},${riseY - 8} Q${x2 - 28},${riseY - 8} ${x2 - 28},${riseY} L${x2 - 28},${y2 - 8} Q${x2 - 28},${y2} ${x2 - 20},${y2} L${x2},${y2}`;
  }

  // Different rows, left-to-right: smooth bezier
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

// ── Phase grouping helpers ───────────────────────────────────────────
function getDominantType(steps: Step[]): string {
  const counts: Record<string, number> = {};
  steps.forEach((s) => {
    counts[s.type] = (counts[s.type] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

interface PhaseBound {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  stepCount: number;
  dominantType: string;
}

function computePhaseBounds(steps: Step[]): PhaseBound[] {
  // Group steps by phase, tracking their index-based positions
  const phaseGroups = new Map<string, { steps: Step[]; positions: { x: number; y: number }[] }>();

  steps.forEach((step, idx) => {
    // Skip steps with no phase — they are not contained
    if (!step.phase) return;
    const phase = step.phase;
    if (!phaseGroups.has(phase)) {
      phaseGroups.set(phase, { steps: [], positions: [] });
    }
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    phaseGroups.get(phase)!.steps.push(step);
    phaseGroups.get(phase)!.positions.push({
      x: col * (NODE_W + GAP_X),
      y: row * (NODE_H + GAP_Y),
    });
  });

  return Array.from(phaseGroups.entries()).map(([name, group]) => {
    const xs = group.positions.map((p) => p.x);
    const ys = group.positions.map((p) => p.y);
    return {
      name,
      x: Math.min(...xs) - PHASE_PADDING,
      y: Math.min(...ys) - PHASE_PADDING - PHASE_LABEL_HEIGHT,
      width: Math.max(...xs) - Math.min(...xs) + NODE_W + PHASE_PADDING * 2,
      height:
        Math.max(...ys) - Math.min(...ys) + NODE_H + PHASE_PADDING * 2 + PHASE_LABEL_HEIGHT,
      stepCount: group.steps.length,
      dominantType: getDominantType(group.steps),
    };
  });
}

// ── Edge label proximity helper ─────────────────────────────────────
function isNearNode(
  point: { x: number; y: number },
  stepCount: number,
): boolean {
  for (let i = 0; i < stepCount; i++) {
    const pos = stepPosition(i);
    if (
      Math.abs(point.x - pos.x - NODE_W / 2) < NODE_W / 2 + 10 &&
      Math.abs(point.y - pos.y - NODE_H / 2) < NODE_H / 2 + 10
    ) {
      return true;
    }
  }
  return false;
}

// ── Components ──────────────────────────────────────────────────────

function StepNode({
  step,
  index,
  isSelected,
  annotationCount,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  step: Step;
  index: number;
  isSelected: boolean;
  annotationCount: number;
  onClick: () => void;
  onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
}) {
  const pos = stepPosition(index);
  return (
    <div
      className={[
        "step-node",
        `type-${step.type}`,
        isSelected ? "selected" : "",
        index === 0 ? "step-node--start" : "",
        step.next.length === 0 ? "step-node--end" : "",
      ].filter(Boolean).join(" ")}
      data-type={step.type}
      style={{ left: pos.x, top: pos.y }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="step-node-header">
        <span
          className="step-type-dot"
          style={{ background: TYPE_COLORS[step.type] }}
        />
        <span className="step-type-label">{TYPE_LABELS[step.type]}</span>
      </div>
      <div className="step-node-label">{step.label}</div>
      <div className="step-node-screen">{step.screen}</div>
      {annotationCount > 0 && (
        <span className="step-annotation-badge">{annotationCount}</span>
      )}
      {index === 0 && <span className="step-badge step-badge--start">START</span>}
      {step.next.length === 0 && <span className="step-badge step-badge--end">END</span>}
    </div>
  );
}

function FlowCanvas({
  journey,
  annotations,
  selectedStep,
  onSelectStep,
  onStepMouseEnter,
  onStepMouseLeave,
}: {
  journey: Journey;
  annotations: Annotation[];
  selectedStep: Step | null;
  onSelectStep: (step: Step) => void;
  onStepMouseEnter: (step: Step, e: React.MouseEvent<HTMLDivElement>) => void;
  onStepMouseLeave: () => void;
}) {
  const stepIndex = new Map(journey.steps.map((s, i) => [s.id, i]));
  const size = canvasSize(journey.steps.length);

  // Compute phase bounding boxes
  const phaseBounds = computePhaseBounds(journey.steps);

  // Build connector data with optional edge labels and source metadata
  const connectors: {
    key: string;
    d: string;
    label?: string;
    mid: { x: number; y: number };
    sourceType: string;
    edgeIndex: number;
    sourceStepId: string;
  }[] = [];
  journey.steps.forEach((step, fromIdx) => {
    const edgeCount = step.next.length;
    const dense = edgeCount >= 6;
    step.next.forEach((nextId, edgeIdx) => {
      const toIdx = stepIndex.get(nextId);
      if (toIdx !== undefined) {
        const fanOffset = dense ? (edgeIdx - (edgeCount - 1) / 2) * 14 : 0;
        connectors.push({
          key: `${step.id}-${nextId}`,
          d: connectorPath(fromIdx, toIdx),
          label: step.edgeLabels?.[edgeIdx],
          mid: connectorMidpoint(fromIdx, toIdx, fanOffset),
          sourceType: step.type,
          edgeIndex: edgeIdx,
          sourceStepId: step.id,
        });
      }
    });
  });

  // Compute active connectors for selected step
  const activeConnectorKeys = new Set<string>();
  if (selectedStep) {
    const selId = selectedStep.id;
    selectedStep.next.forEach((nextId) => {
      activeConnectorKeys.add(`${selId}-${nextId}`);
    });
    journey.steps.forEach((s) => {
      if (s.next.includes(selId)) {
        activeConnectorKeys.add(`${s.id}-${selId}`);
      }
    });
  }

  return (
    <div className="flow-container" style={{ width: size.w, height: size.h }}>
      {/* Phase containers — rendered first so they sit behind nodes (z-index: 0) */}
      {phaseBounds.map((phase) => (
        <div
          key={phase.name}
          className={`phase-container phase-type-${phase.dominantType}`}
          style={{
            left: phase.x,
            top: phase.y,
            width: phase.width,
            height: phase.height,
          }}
        >
          <div className="phase-label">{phase.name}</div>
          <div className="phase-count">{phase.stepCount} steps</div>
        </div>
      ))}

      <svg
        className="flow-svg"
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 7"
            refX="9"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,3.5 L0,7 Z" />
          </marker>
          <marker
            id="arrow-active"
            viewBox="0 0 10 7"
            refX="9"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,3.5 L0,7 Z" fill="#007aff" />
          </marker>
        </defs>
        {connectors.map((c) => {
          const classes: string[] = [];

          // Active/inactive state
          if (selectedStep) {
            if (activeConnectorKeys.has(c.key)) {
              classes.push("connector-active");
            } else {
              classes.push("connector-inactive");
            }
          }

          // Dashed edges for decision source nodes
          if (c.sourceType === "decision") {
            classes.push("connector--from-decision");
          }

          // Primary (index 0) vs secondary (index 1+) thickness
          if (c.edgeIndex === 0) {
            classes.push("connector--primary");
          } else {
            classes.push("connector--secondary");
          }

          // Branch color-coding when selected node is a decision and this edge originates from it
          const isSelectedDecisionSource =
            selectedStep !== null &&
            selectedStep.type === "decision" &&
            c.sourceStepId === selectedStep.id;

          if (isSelectedDecisionSource) {
            if (c.edgeIndex === 0) {
              classes.push("connector--branch-yes");
            } else if (c.edgeIndex === 1) {
              classes.push("connector--branch-no");
            } else {
              classes.push("connector--branch-alt");
            }
          }

          const cls = classes.join(" ");
          const isActive = classes.includes("connector-active");
          return (
            <path
              key={c.key}
              d={c.d}
              className={cls}
              markerEnd={isActive ? "url(#arrow-active)" : "url(#arrow)"}
            />
          );
        })}
        {connectors.filter((c) => c.label).map((c) => {
          const isInactive = selectedStep && !activeConnectorKeys.has(c.key);
          const labelYOffset = isNearNode(c.mid, journey.steps.length) ? -20 : 0;
          return (
            <foreignObject
              key={`lbl-${c.key}`}
              x={c.mid.x - 50}
              y={c.mid.y - 10 + labelYOffset}
              width={100}
              height={20}
              style={{ overflow: "visible", pointerEvents: "none" }}
              className={isInactive ? "connector-label-inactive" : ""}
            >
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div className="edge-label-pill">{c.label}</div>
              </div>
            </foreignObject>
          );
        })}
      </svg>

      {journey.steps.map((step, i) => (
        <StepNode
          key={step.id}
          step={step}
          index={i}
          isSelected={selectedStep?.id === step.id}
          annotationCount={
            annotations.filter(
              (a) => a.journeyId === journey.id && a.stepId === step.id,
            ).length
          }
          onClick={() => onSelectStep(step)}
          onMouseEnter={(e) => onStepMouseEnter(step, e)}
          onMouseLeave={onStepMouseLeave}
        />
      ))}
    </div>
  );
}

function AnnotationPanel({
  journey,
  step,
  annotations,
  onSave,
  onDelete,
  onClose,
}: {
  journey: Journey;
  step: Step;
  annotations: Annotation[];
  onSave: (ann: Omit<Annotation, "createdAt">) => void;
  onDelete: (ann: Annotation) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState<Annotation["type"]>("note");
  const [priority, setPriority] = useState<Annotation["priority"]>("suggestion");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stepAnnotations = annotations.filter(
    (a) => a.journeyId === journey.id && a.stepId === step.id,
  );

  // Focus textarea when step changes
  useEffect(() => {
    setText("");
    textareaRef.current?.focus();
  }, [step.id]);

  const handleSave = () => {
    if (!text.trim()) return;
    onSave({
      stepId: step.id,
      journeyId: journey.id,
      type,
      text: text.trim(),
      priority,
    });
    setText("");
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Step Details</h3>
        <button className="panel-close" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Step info */}
      <div className="panel-section">
        <div className="panel-field">
          <label>Label</label>
          <div className="panel-field-value">{step.label}</div>
        </div>
        <div className="panel-field">
          <label>Screen</label>
          <div className="panel-field-value">{step.screen}</div>
        </div>
        {step.swiftFile && (
          <div className="panel-field">
            <label>Swift File</label>
            <div className="panel-field-value">{step.swiftFile}</div>
          </div>
        )}
        <div className="panel-field">
          <label>Type</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              className="step-type-dot"
              style={{ background: TYPE_COLORS[step.type] }}
            />
            <span style={{ fontSize: 13 }}>{TYPE_LABELS[step.type]}</span>
          </div>
        </div>
        {step.phase && (
          <div className="panel-field">
            <label>Phase</label>
            <div className="panel-field-value">{step.phase}</div>
          </div>
        )}
        {step.next.length > 0 && (
          <div className="panel-field">
            <label>Connects to</label>
            <ul className="panel-connections-list">
              {step.next.map((nextId, i) => (
                <li key={nextId}>
                  <span>{nextId}</span>
                  {step.edgeLabels?.[i] && (
                    <span className="panel-edge-label">{step.edgeLabels[i]}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* New annotation form */}
      <div className="panel-section">
        <div className="panel-section-title">Add Annotation</div>
        <div className="panel-field">
          <label>Note</label>
          <textarea
            ref={textareaRef}
            className="panel-textarea"
            placeholder="Add your note, feedback, or change request..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) handleSave();
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div className="panel-field" style={{ flex: 1 }}>
            <label>Type</label>
            <select
              className="panel-select"
              value={type}
              onChange={(e) => setType(e.target.value as Annotation["type"])}
            >
              <option value="note">Note</option>
              <option value="change-request">Change Request</option>
              <option value="bug">Bug</option>
              <option value="question">Question</option>
            </select>
          </div>
          <div className="panel-field" style={{ flex: 1 }}>
            <label>Priority</label>
            <select
              className="panel-select"
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as Annotation["priority"])
              }
            >
              <option value="suggestion">Suggestion</option>
              <option value="required">Required</option>
              <option value="blocker">Blocker</option>
            </select>
          </div>
        </div>
        <button
          className="panel-btn panel-btn-primary"
          disabled={!text.trim()}
          onClick={handleSave}
        >
          Save Annotation
        </button>
      </div>

      {/* Existing annotations */}
      {stepAnnotations.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">
            Annotations ({stepAnnotations.length})
          </div>
          {stepAnnotations.map((ann, i) => (
            <div key={i} className="annotation-item">
              <div className="annotation-item-header">
                <span className={`annotation-type-pill type-${ann.type}`}>
                  {ann.type.replace("-", " ")}
                </span>
                <span className={`priority-dot priority-${ann.priority}`} />
              </div>
              <div className="annotation-item-text">{ann.text}</div>
              <div className="annotation-item-date">
                {new Date(ann.createdAt).toLocaleString()}
              </div>
              <button
                className="annotation-delete"
                onClick={() => onDelete(ann)}
                title="Delete annotation"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────────────

function App() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const spaceHeldRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const [handMode, setHandMode] = useState(false);
  const handModeRef = useRef(false);
  const [tooltipStep, setTooltipStep] = useState<{ step: Step; x: number; y: number } | null>(null);
  const tooltipTimeout = useRef<number | null>(null);

  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 2.5;
  const ZOOM_STEP = 0.15;

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  }, []);

  const zoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  const zoomToFit = useCallback(() => {
    if (!selectedJourney || !canvasRef.current) return;
    const el = canvasRef.current;
    const size = canvasSize(selectedJourney.steps.length);
    const contentW = size.w + 60;
    const contentH = size.h + 60;
    const viewW = el.clientWidth - 80;
    const viewH = el.clientHeight - 80;
    const scaleX = viewW / contentW;
    const scaleY = viewH / contentH;
    const fitZoom = Math.min(scaleX, scaleY, ZOOM_MAX);
    const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +fitZoom.toFixed(2)));
    setZoom(clampedZoom);
    requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      const totalW = (contentW + CANVAS_PADDING * 2) * clampedZoom;
      const totalH = (contentH + CANVAS_PADDING * 2) * clampedZoom;
      canvasRef.current.scrollLeft = (totalW - canvasRef.current.clientWidth) / 2;
      canvasRef.current.scrollTop = (totalH - canvasRef.current.clientHeight) / 2;
    });
  }, [selectedJourney]);

  // Load data on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/workflows").then((r) => r.json()),
      fetch("/api/annotations").then((r) => r.json()),
    ]).then(([wf, ann]) => {
      const j = wf.journeys || [];
      setJourneys(j);
      setAnnotations(ann.annotations || []);
      if (j.length > 0) setSelectedJourney(j[0]);
    });
  }, []);

  // Wheel zoom: Ctrl/Cmd + scroll
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Clear tooltip on any scroll or zoom gesture
      if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
      setTooltipStep(null);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.003;
        setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z + delta).toFixed(2))));
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Keyboard zoom: Cmd/Ctrl + Plus/Minus/0
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        zoomReset();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [zoomIn, zoomOut, zoomReset]);

  // Shift+1 = Zoom to Fit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "!") {
        e.preventDefault();
        zoomToFit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [zoomToFit]);

  // Arrow key pan: 50px per press
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const el = canvasRef.current;
      if (!el) return;
      const PAN_STEP = 50;
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          el.scrollTop -= PAN_STEP;
          break;
        case "ArrowDown":
          e.preventDefault();
          el.scrollTop += PAN_STEP;
          break;
        case "ArrowLeft":
          e.preventDefault();
          el.scrollLeft -= PAN_STEP;
          break;
        case "ArrowRight":
          e.preventDefault();
          el.scrollLeft += PAN_STEP;
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // H key toggles hand/pan mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.key === "h" || e.key === "H") && !e.repeat) {
        setHandMode((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Sync handMode state to ref
  useEffect(() => {
    handModeRef.current = handMode;
  }, [handMode]);

  // Space key tracking for pan mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && e.target === document.body) {
        e.preventDefault();
        spaceHeldRef.current = true;
        canvasRef.current?.classList.add("pan-ready");
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
        canvasRef.current?.classList.remove("pan-ready");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Auto-center on journey change
  useEffect(() => {
    if (!selectedJourney || !canvasRef.current) return;
    requestAnimationFrame(() => {
      if (canvasRef.current) {
        scrollToCenter(canvasRef.current, 0, zoom);
      }
    });
  }, [selectedJourney]);

  // Pan: middle-click drag or Space+click drag
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleMouseDown = (e: MouseEvent) => {
      const isMiddleClick = e.button === 1;
      const isSpaceClick = e.button === 0 && spaceHeldRef.current;
      const isHandClick = e.button === 0 && handModeRef.current;
      if (!isMiddleClick && !isSpaceClick && !isHandClick) return;

      e.preventDefault();
      if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
      setTooltipStep(null);
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      };
      setPanning(true);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      el.scrollLeft = panStartRef.current.scrollLeft - dx;
      el.scrollTop = panStartRef.current.scrollTop - dy;
    };

    const handleMouseUp = () => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      setPanning(false);
    };

    el.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      el.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const saveAnnotations = useCallback(
    async (updated: Annotation[]) => {
      setAnnotations(updated);
      await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations: updated }),
      });
    },
    [],
  );

  const handleAddAnnotation = useCallback(
    (ann: Omit<Annotation, "createdAt">) => {
      const full: Annotation = { ...ann, createdAt: new Date().toISOString() };
      saveAnnotations([...annotations, full]);
    },
    [annotations, saveAnnotations],
  );

  const handleDeleteAnnotation = useCallback(
    (ann: Annotation) => {
      const updated = annotations.filter((a) => a !== ann);
      saveAnnotations(updated);
    },
    [annotations, saveAnnotations],
  );

  const journeyAnnotationCount = useCallback(
    (journeyId: string) =>
      annotations.filter((a) => a.journeyId === journeyId).length,
    [annotations],
  );

  const handleStepMouseEnter = useCallback(
    (step: Step, e: React.MouseEvent<HTMLDivElement>) => {
      // Don't show tooltip when step is already selected (panel is open)
      if (selectedStep?.id === step.id) return;
      if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
      const rect = e.currentTarget.getBoundingClientRect();
      tooltipTimeout.current = window.setTimeout(() => {
        setTooltipStep({ step, x: rect.left + rect.width / 2, y: rect.top });
      }, 400);
    },
    [selectedStep],
  );

  const handleStepMouseLeave = useCallback(() => {
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    setTooltipStep(null);
  }, []);

  const panelOpen = selectedStep !== null && selectedJourney !== null;

  return (
    <div className={`app ${panelOpen ? "panel-open" : ""}`}>
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>TaskFlow Demo</h1>
          <p>
            {journeys.length} journeys &middot;{" "}
            {annotations.length} annotations
          </p>
        </div>
        <div className="journey-list">
          {journeys.map((j) => {
            const annCount = journeyAnnotationCount(j.id);
            return (
              <div
                key={j.id}
                className={`journey-card ${
                  selectedJourney?.id === j.id ? "active" : ""
                }`}
                onClick={() => {
                  setSelectedJourney(j);
                  setSelectedStep(null);
                }}
              >
                <div className="journey-card-name">{j.name}</div>
                <div className="journey-card-meta">
                  {j.steps.length} steps
                </div>
                {annCount > 0 && (
                  <span className="journey-card-badge">{annCount}</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="legend">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <span key={type} className="legend-item">
              <span className="legend-dot" style={{ background: color }} />
              {TYPE_LABELS[type]}
            </span>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className={`canvas${panning ? " panning" : ""}${handMode ? " hand-mode" : ""}`} ref={canvasRef}>
        {selectedJourney ? (
          <>
            <div className="canvas-header">
              <h2>{selectedJourney.name}</h2>
              <p>{selectedJourney.description}</p>
            </div>
            <div
              className={`flow-viewport${zoom > 1.5 ? " zoom-dense" : ""}`}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "0 0",
                transition: "transform 0.15s ease-out",
              }}
            >
              <FlowCanvas
                journey={selectedJourney}
                annotations={annotations}
                selectedStep={selectedStep}
                onSelectStep={(step) => {
                  if (!handModeRef.current) setSelectedStep(step);
                }}
                onStepMouseEnter={handleStepMouseEnter}
                onStepMouseLeave={handleStepMouseLeave}
              />
            </div>
            <div className="zoom-toolbar">
              <div className="zoom-toolbar-inner">
                <button className="zoom-btn" onClick={zoomOut} title="Zoom Out (Cmd -)">-</button>
                <span className="zoom-level" onClick={zoomReset} title="Reset Zoom (Cmd 0)">
                  {Math.round(zoom * 100)}%
                </span>
                <button className="zoom-btn" onClick={zoomIn} title="Zoom In (Cmd +)">+</button>
                <span className="zoom-toolbar-divider" />
                <button className="zoom-btn" onClick={zoomToFit} title="Zoom to Fit (Shift 1)" style={{ width: 'auto', padding: '0 8px', fontSize: 11 }}>Fit</button>
              </div>
            </div>
            {handMode && (
              <div className="hand-mode-indicator">Hand Tool (H)</div>
            )}
          </>
        ) : (
          <div className="canvas-empty">
            Select a journey from the sidebar
          </div>
        )}
      </div>

      {/* Annotation panel */}
      {panelOpen && selectedJourney && selectedStep && (
        <AnnotationPanel
          journey={selectedJourney}
          step={selectedStep}
          annotations={annotations}
          onSave={handleAddAnnotation}
          onDelete={handleDeleteAnnotation}
          onClose={() => setSelectedStep(null)}
        />
      )}

      {/* Tooltip (position: fixed, renders above everything) */}
      {tooltipStep && (
        <div
          className="step-tooltip"
          style={{ left: tooltipStep.x, top: tooltipStep.y - 8 }}
        >
          <div className="step-tooltip-label">{tooltipStep.step.label}</div>
          <div className="step-tooltip-row">
            <span className="step-tooltip-key">Type</span>
            <span className={`step-tooltip-value step-tooltip-type type-${tooltipStep.step.type}`}>
              {TYPE_LABELS[tooltipStep.step.type]}
            </span>
          </div>
          <div className="step-tooltip-row">
            <span className="step-tooltip-key">Screen</span>
            <span className="step-tooltip-value step-tooltip-mono">{tooltipStep.step.screen}</span>
          </div>
          {tooltipStep.step.phase && (
            <div className="step-tooltip-row">
              <span className="step-tooltip-key">Phase</span>
              <span className="step-tooltip-value">{tooltipStep.step.phase}</span>
            </div>
          )}
          <div className="step-tooltip-row">
            <span className="step-tooltip-key">Connections</span>
            <span className="step-tooltip-value">{tooltipStep.step.next.length} out</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mount ───────────────────────────────────────────────────────────
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
