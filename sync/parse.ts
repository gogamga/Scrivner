/**
 * sync/parse.ts — Pure function: parse a Swift UI file → ParsedView.
 *
 * Extracts struct name, navigation destinations (presentsTo), and infers step type.
 */

export interface NavEdge {
  destination: string; // e.g. "FooView"
  mechanism: string;   // e.g. "sheet", "navigationLink", etc.
}

export interface ParsedView {
  structName: string;
  filePath: string;
  presentsTo: NavEdge[];
  inferredType: "action" | "display" | "decision" | "input" | "system";
}

// ── Struct name ────────────────────────────────────────────────────

const STRUCT_RE = /\bstruct\s+(\w+)\s*:\s*View\b/;

function extractStructName(content: string): string | null {
  const m = content.match(STRUCT_RE);
  return m ? m[1] : null;
}

// ── Nav edge extraction ───────────────────────────────────────────

// Each pattern: [regex, mechanism]
// Regex must capture the destination view name in group 1.
const NAV_PATTERNS: [RegExp, string][] = [
  // .sheet(...) { FooView(
  [/\.sheet\s*\([^)]*\)\s*\{[^{]*?(\w+View)\s*\(/gs, "sheet"],
  // .fullScreenCover(...) { FooView(
  [/\.fullScreenCover\s*\([^)]*\)\s*\{[^{]*?(\w+View)\s*\(/gs, "fullScreenCover"],
  // NavigationLink { FooView(
  [/NavigationLink\s*\{[^{]*?(\w+View)\s*\(/gs, "navigationLink"],
  // .navigationDestination(...) { FooView(
  [/\.navigationDestination\s*\([^)]*\)\s*\{[^{]*?(\w+View)\s*\(/gs, "navigationDestination"],
  // TabView children: Tab { FooView( or direct child view mentions
  [/\bTab\s*\{[^{]*?(\w+View)\s*\(/gs, "tabView"],
];

function extractEdges(content: string): NavEdge[] {
  const edges: NavEdge[] = [];
  const seen = new Set<string>(); // deduplicate

  for (const [re, mechanism] of NAV_PATTERNS) {
    // Reset lastIndex for global regexes
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const destination = m[1];
      const key = `${destination}::${mechanism}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ destination, mechanism });
      }
    }
  }

  return edges;
}

// ── Type inference ────────────────────────────────────────────────

const INPUT_INDICATORS = /\b(TextField|TextEditor|Picker|Toggle|SecureField|Slider|Stepper)\b/;
const DISMISS_INDICATORS = /\bdismiss\s*\(\)|presentationMode\.wrappedValue\.dismiss/;
const BUTTON_INDICATORS = /\bButton\s*\(/;
const CONDITIONAL_NAV = /if\s+\w+\s*\{[\s\S]*?(NavigationLink|\.sheet|\.fullScreenCover)/;
const BACKGROUND_ONLY = /\bTask\s*\{|\.task\s*\{|\.onAppear\s*\{/;
const HAS_ANY_BODY_CONTENT = /\bvar\s+body\s*:/;

function inferType(content: string): ParsedView["inferredType"] {
  if (INPUT_INDICATORS.test(content)) return "input";

  // Decision: conditional nav branches
  if (CONDITIONAL_NAV.test(content)) return "decision";

  // Action: primary button with dismiss (implies this view IS the action)
  // or the struct name itself sounds action-like
  if (BUTTON_INDICATORS.test(content) && DISMISS_INDICATORS.test(content)) return "action";

  // System: background task only, no visible body content worth classifying
  if (!HAS_ANY_BODY_CONTENT.test(content) || (!BUTTON_INDICATORS.test(content) && BACKGROUND_ONLY.test(content))) {
    return "system";
  }

  return "display";
}

// ── Public API ───────────────────────────────────────────────────

export function parseSwiftFile(filePath: string, content: string): ParsedView | null {
  const structName = extractStructName(content);
  if (!structName) return null;

  return {
    structName,
    filePath,
    presentsTo: extractEdges(content),
    inferredType: inferType(content),
  };
}
