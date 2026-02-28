/**
 * sync/sync.test.ts — Tests for parse, merge, validate.
 *
 * Tier 1: Unit tests (parse patterns, merge rules, validate cases)
 * Tier 2: Integration test with a temp git repo + Swift fixtures
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { parseSwiftFile } from "./parse";
import type { ParsedView } from "./parse";
import { merge } from "./merge";
import type { WorkflowDefs, Step, Journey } from "./merge";
import { validate } from "./validate";
import { scan } from "./scan";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

// ══════════════════════════════════════════════════════════════════════════
// Tier 1: Unit Tests — parse.ts
// ══════════════════════════════════════════════════════════════════════════

describe("parse.ts — struct name extraction", () => {
  test("extracts struct name from View conformance", () => {
    const content = `struct LoginView: View { var body: some View { Text("hi") } }`;
    const result = parseSwiftFile("Login.swift", content);
    expect(result?.structName).toBe("LoginView");
  });

  test("returns null if no View conformance", () => {
    const content = `class Foo { }`;
    expect(parseSwiftFile("Foo.swift", content)).toBeNull();
  });

  test("handles whitespace around colon", () => {
    const content = `struct SomeView : View { }`;
    const result = parseSwiftFile("Some.swift", content);
    expect(result?.structName).toBe("SomeView");
  });
});

describe("parse.ts — navigation edge extraction", () => {
  test(".sheet pattern", () => {
    const content = `
      struct HomeView: View {
        var body: some View {
          Button("tap") {}
            .sheet(isPresented: $show) {
              DetailView()
            }
        }
      }
    `;
    const result = parseSwiftFile("Home.swift", content)!;
    expect(result.presentsTo).toContainEqual({ destination: "DetailView", mechanism: "sheet" });
  });

  test("NavigationLink pattern", () => {
    const content = `
      struct RootView: View {
        var body: some View {
          NavigationLink {
            SettingsView()
          } label: { Text("Settings") }
        }
      }
    `;
    const result = parseSwiftFile("Root.swift", content)!;
    expect(result.presentsTo).toContainEqual({ destination: "SettingsView", mechanism: "navigationLink" });
  });

  test(".navigationDestination pattern", () => {
    const content = `
      struct ListViewWrapper: View {
        var body: some View {
          List { }
            .navigationDestination(isPresented: $go) {
              EditorView()
            }
        }
      }
    `;
    const result = parseSwiftFile("List.swift", content)!;
    expect(result.presentsTo).toContainEqual({ destination: "EditorView", mechanism: "navigationDestination" });
  });

  test(".fullScreenCover pattern", () => {
    const content = `
      struct OnboardingView: View {
        var body: some View {
          Color.clear
            .fullScreenCover(isPresented: $show) {
              PaywallView()
            }
        }
      }
    `;
    const result = parseSwiftFile("Onboarding.swift", content)!;
    expect(result.presentsTo).toContainEqual({ destination: "PaywallView", mechanism: "fullScreenCover" });
  });

  test("deduplicates same edge", () => {
    const content = `
      struct FeedView: View {
        var body: some View {
          Group {
            .sheet(isPresented: $a) { ArticleView() }
            .sheet(isPresented: $b) { ArticleView() }
          }
        }
      }
    `;
    const result = parseSwiftFile("Feed.swift", content)!;
    const sheets = result.presentsTo.filter(e => e.destination === "ArticleView" && e.mechanism === "sheet");
    expect(sheets.length).toBe(1);
  });
});

describe("parse.ts — type inference", () => {
  test("TextField → input", () => {
    const content = `struct SearchView: View { var body: some View { TextField("q", text: $q) } }`;
    expect(parseSwiftFile("Search.swift", content)?.inferredType).toBe("input");
  });

  test("Picker → input", () => {
    const content = `struct PrefView: View { var body: some View { Picker("x", selection: $s) {} } }`;
    expect(parseSwiftFile("Pref.swift", content)?.inferredType).toBe("input");
  });

  test("conditional nav → decision", () => {
    const content = `
      struct SplashView: View {
        var body: some View {
          if isLoggedIn {
            NavigationLink { HomeView() } label: { EmptyView() }
          }
        }
      }
    `;
    expect(parseSwiftFile("Splash.swift", content)?.inferredType).toBe("decision");
  });

  test("Button + dismiss → action", () => {
    const content = `
      struct ConfirmView: View {
        @Environment(\\.dismiss) var dismiss
        var body: some View {
          Button("OK") { dismiss() }
        }
      }
    `;
    expect(parseSwiftFile("Confirm.swift", content)?.inferredType).toBe("action");
  });

  test("plain display view → display", () => {
    const content = `
      struct WelcomeView: View {
        var body: some View {
          VStack { Text("Welcome!") Image("hero") }
        }
      }
    `;
    expect(parseSwiftFile("Welcome.swift", content)?.inferredType).toBe("display");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Tier 1: Unit Tests — merge.ts
// ══════════════════════════════════════════════════════════════════════════

function makeWorkflow(journeys: Journey[] = []): WorkflowDefs {
  return { version: "1.0", generatedAt: new Date().toISOString(), journeys };
}

function makeJourney(id: string, steps: Step[] = []): Journey {
  return { id, name: id, description: "", steps };
}

function makeStep(id: string, overrides: Partial<Step> = {}): Step {
  return {
    id,
    label: id,
    screen: id,
    swiftFile: `${id}.swift`,
    type: "display",
    phase: "Unassigned",
    next: [],
    ...overrides,
  };
}

describe("merge.ts — new files", () => {
  test("adds a new step for a new file", () => {
    const defs = makeWorkflow([makeJourney("first-launch", [makeStep("existing")])]);
    const parsed: ParsedView = {
      structName: "WelcomeView",
      filePath: "ExampleApp/Sources/UI/Onboarding/WelcomeView.swift",
      presentsTo: [],
      inferredType: "display",
    };
    const result = merge(
      defs,
      { currentSHA: "abc", newFiles: [{ path: parsed.filePath, content: "", diff: "", status: "A" }], removedFiles: [], modifiedFiles: [] },
      [parsed]
    );
    const journey = result.json.journeys.find(j => j.id === "first-launch")!;
    const step = journey.steps.find(s => s.screen === "WelcomeView");
    expect(step).toBeDefined();
    expect(step?._needsReview).toBe(true);
    expect(step?.label).toBe("TODO: WelcomeView");
    expect(result.reviewCount).toBe(1);
  });

  test("routes Onboarding file → first-launch journey", () => {
    const defs = makeWorkflow();
    const parsed: ParsedView = {
      structName: "OnboardingStep1View",
      filePath: "ExampleApp/Sources/UI/Onboarding/OnboardingStep1View.swift",
      presentsTo: [],
      inferredType: "display",
    };
    const result = merge(
      defs,
      { currentSHA: "x", newFiles: [{ path: parsed.filePath, content: "", diff: "", status: "A" }], removedFiles: [], modifiedFiles: [] },
      [parsed]
    );
    const journey = result.json.journeys.find(j => j.id === "first-launch");
    expect(journey).toBeDefined();
  });

  test("routes ExampleAppShare file → capture-via-share", () => {
    const defs = makeWorkflow();
    const parsed: ParsedView = {
      structName: "ShareExtView",
      filePath: "ExampleAppShare/ShareExtView.swift",
      presentsTo: [],
      inferredType: "display",
    };
    const result = merge(
      defs,
      { currentSHA: "x", newFiles: [{ path: parsed.filePath, content: "", diff: "", status: "A" }], removedFiles: [], modifiedFiles: [] },
      [parsed]
    );
    const journey = result.json.journeys.find(j => j.id === "capture-via-share");
    expect(journey).toBeDefined();
  });

  test("routes ExampleAppAction file → capture-via-action", () => {
    const defs = makeWorkflow();
    const parsed: ParsedView = {
      structName: "ActionExtView",
      filePath: "ExampleAppAction/ActionExtView.swift",
      presentsTo: [],
      inferredType: "display",
    };
    const result = merge(
      defs,
      { currentSHA: "x", newFiles: [{ path: parsed.filePath, content: "", diff: "", status: "A" }], removedFiles: [], modifiedFiles: [] },
      [parsed]
    );
    const journey = result.json.journeys.find(j => j.id === "capture-via-action");
    expect(journey).toBeDefined();
  });

  test("does not add duplicate if file already tracked", () => {
    const existing = makeStep("welcome-view", { swiftFile: "ExampleApp/Sources/UI/Onboarding/WelcomeView.swift" });
    const defs = makeWorkflow([makeJourney("first-launch", [existing])]);
    const parsed: ParsedView = {
      structName: "WelcomeView",
      filePath: "ExampleApp/Sources/UI/Onboarding/WelcomeView.swift",
      presentsTo: [],
      inferredType: "display",
    };
    const result = merge(
      defs,
      { currentSHA: "x", newFiles: [{ path: parsed.filePath, content: "", diff: "", status: "A" }], removedFiles: [], modifiedFiles: [] },
      [parsed]
    );
    const journey = result.json.journeys.find(j => j.id === "first-launch")!;
    const stepsForFile = journey.steps.filter(s => s.swiftFile === parsed.filePath);
    expect(stepsForFile.length).toBe(1);
  });
});

describe("merge.ts — removed files", () => {
  test("marks step deprecated when file removed", () => {
    const step = makeStep("note-view", { swiftFile: "ExampleApp/Sources/UI/Views/NoteView.swift" });
    const defs = makeWorkflow([makeJourney("main", [step])]);
    const result = merge(
      defs,
      { currentSHA: "x", newFiles: [], removedFiles: ["ExampleApp/Sources/UI/Views/NoteView.swift"], modifiedFiles: [] },
      []
    );
    const found = result.json.journeys.find(j => j.id === "main")?.steps.find(s => s.id === "note-view");
    expect(found?.deprecated).toBe(true);
    expect(result.changes.some(c => c.action === "deprecate")).toBe(true);
  });

  test("does not delete the step, only marks deprecated", () => {
    const step = makeStep("editor", { swiftFile: "ExampleApp/Sources/UI/Views/EditorView.swift" });
    const defs = makeWorkflow([makeJourney("notes", [step])]);
    const result = merge(
      defs,
      { currentSHA: "x", newFiles: [], removedFiles: ["ExampleApp/Sources/UI/Views/EditorView.swift"], modifiedFiles: [] },
      []
    );
    const journey = result.json.journeys.find(j => j.id === "notes")!;
    expect(journey.steps.find(s => s.id === "editor")).toBeDefined();
  });
});

describe("merge.ts — modified files", () => {
  test("updates next[] when edges change", () => {
    const stepA = makeStep("view-a", { swiftFile: "ExampleApp/Sources/UI/Views/ViewA.swift", screen: "ViewA", next: [] });
    const stepB = makeStep("view-b", { swiftFile: "ExampleApp/Sources/UI/Views/ViewB.swift", screen: "ViewB", next: [] });
    const defs = makeWorkflow([makeJourney("main", [stepA, stepB])]);

    const parsed: ParsedView = {
      structName: "ViewA",
      filePath: "ExampleApp/Sources/UI/Views/ViewA.swift",
      presentsTo: [{ destination: "ViewB", mechanism: "sheet" }],
      inferredType: "display",
    };

    const result = merge(
      defs,
      { currentSHA: "x", newFiles: [], removedFiles: [], modifiedFiles: [{ path: parsed.filePath, content: "", diff: "", status: "M" }] },
      [parsed]
    );

    const foundA = result.json.journeys.find(j => j.id === "main")?.steps.find(s => s.id === "view-a");
    expect(foundA?.next).toContain("view-b");
    expect(result.changes.some(c => c.action === "update-edges")).toBe(true);
  });

  test("preserves edgeLabels on update (trims if next shrinks)", () => {
    const stepA = makeStep("a", { screen: "AView", swiftFile: "a.swift", next: ["b", "c"], edgeLabels: ["Yes", "No"] });
    const stepB = makeStep("b", { screen: "BView", swiftFile: "b.swift" });
    const stepC = makeStep("c", { screen: "CView", swiftFile: "c.swift" });
    const defs = makeWorkflow([makeJourney("j", [stepA, stepB, stepC])]);

    // Modified: now only presents to BView (not CView)
    const parsed: ParsedView = {
      structName: "AView",
      filePath: "a.swift",
      presentsTo: [{ destination: "BView", mechanism: "sheet" }],
      inferredType: "display",
    };

    const result = merge(
      defs,
      { currentSHA: "x", newFiles: [], removedFiles: [], modifiedFiles: [{ path: "a.swift", content: "", diff: "", status: "M" }] },
      [parsed]
    );

    const found = result.json.journeys.find(j => j.id === "j")?.steps.find(s => s.id === "a");
    expect(found?.next).toEqual(["b"]);
    expect(found?.edgeLabels).toEqual(["Yes"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Tier 1: Unit Tests — validate.ts
// ══════════════════════════════════════════════════════════════════════════

describe("validate.ts — passing cases", () => {
  test("validates a well-formed WorkflowDefs", () => {
    const step = makeStep("s1");
    const defs = makeWorkflow([makeJourney("j1", [step])]);
    const result = validate(defs, defs);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("allows adding up to 3 journeys", () => {
    const base = makeWorkflow([makeJourney("j0")]);
    const added = makeWorkflow([
      makeJourney("j0"),
      makeJourney("j1"),
      makeJourney("j2"),
      makeJourney("j3"),
    ]);
    const result = validate(base, added);
    expect(result.ok).toBe(true);
  });
});

describe("validate.ts — failing cases", () => {
  test("fails if journeys is not an array", () => {
    const result = validate(makeWorkflow(), { journeys: null as any });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("journeys"))).toBe(true);
  });

  test("fails if step is missing label", () => {
    const step = { ...makeStep("s1"), label: "" };
    const defs = makeWorkflow([makeJourney("j1", [step])]);
    const result = validate(defs, defs);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("label"))).toBe(true);
  });

  test("fails on invalid step type", () => {
    const step = { ...makeStep("s1"), type: "unknown" as any };
    const defs = makeWorkflow([makeJourney("j1", [step])]);
    const result = validate(defs, defs);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("type"))).toBe(true);
  });

  test("fails on next[] ref to nonexistent step", () => {
    const step = makeStep("s1", { next: ["ghost"] });
    const defs = makeWorkflow([makeJourney("j1", [step])]);
    const result = validate(defs, defs);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('"ghost"'))).toBe(true);
  });

  test("fails if step IDs are duplicated within a journey", () => {
    const defs = makeWorkflow([makeJourney("j1", [makeStep("dup"), makeStep("dup")])]);
    const result = validate(defs, defs);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("duplicate"))).toBe(true);
  });

  test("fails if too many journeys added (+4)", () => {
    const base = makeWorkflow([makeJourney("j0")]);
    const excess = makeWorkflow([
      makeJourney("j0"), makeJourney("j1"), makeJourney("j2"),
      makeJourney("j3"), makeJourney("j4"),
    ]);
    const result = validate(base, excess);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("Too many journeys added"))).toBe(true);
  });

  test("fails if a non-deprecated step is removed", () => {
    const base = makeWorkflow([makeJourney("j1", [makeStep("s1"), makeStep("s2")])]);
    const incoming = makeWorkflow([makeJourney("j1", [makeStep("s1")])]);
    const result = validate(base, incoming);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("s2"))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Tier 2: Integration Test — temp git repo + Swift fixtures
// ══════════════════════════════════════════════════════════════════════════

const TMP_REPO = join(import.meta.dir, "__test_repo__");

const FIXTURE_VIEWS = {
  "ExampleApp/Sources/UI/Views/NoteListView.swift": `
    struct NoteListView: View {
      var body: some View {
        NavigationLink {
          NoteDetailView()
        } label: { Text("Note") }
      }
    }
  `,
  "ExampleApp/Sources/UI/Views/NoteDetailView.swift": `
    struct NoteDetailView: View {
      var body: some View {
        VStack { Text("Detail") }
      }
    }
  `,
};

async function runGit(cwd: string, ...args: string[]) {
  return Bun.$`git -C ${cwd} ${args}`.quiet();
}

describe("Integration: full pipeline", () => {
  let initialSHA: string;
  let secondSHA: string;

  beforeAll(async () => {
    // Set up a fresh git repo
    rmSync(TMP_REPO, { recursive: true, force: true });
    mkdirSync(TMP_REPO, { recursive: true });

    await runGit(TMP_REPO, "init");
    await runGit(TMP_REPO, "config", "user.email", "test@test.com");
    await runGit(TMP_REPO, "config", "user.name", "Test");

    // Create directory structure
    mkdirSync(join(TMP_REPO, "ExampleApp/Sources/UI/Views"), { recursive: true });

    // Initial commit: just NoteListView
    const listPath = join(TMP_REPO, "ExampleApp/Sources/UI/Views/NoteListView.swift");
    writeFileSync(listPath, FIXTURE_VIEWS["ExampleApp/Sources/UI/Views/NoteListView.swift"]);

    await runGit(TMP_REPO, "add", ".");
    await runGit(TMP_REPO, "commit", "-m", "initial");
    const sha1 = await Bun.$`git -C ${TMP_REPO} rev-parse HEAD`.quiet();
    initialSHA = sha1.stdout.toString().trim();

    // Second commit: add NoteDetailView
    const detailPath = join(TMP_REPO, "ExampleApp/Sources/UI/Views/NoteDetailView.swift");
    writeFileSync(detailPath, FIXTURE_VIEWS["ExampleApp/Sources/UI/Views/NoteDetailView.swift"]);
    await runGit(TMP_REPO, "add", ".");
    await runGit(TMP_REPO, "commit", "-m", "add detail view");
    const sha2 = await Bun.$`git -C ${TMP_REPO} rev-parse HEAD`.quiet();
    secondSHA = sha2.stdout.toString().trim();
  });

  afterAll(() => {
    rmSync(TMP_REPO, { recursive: true, force: true });
  });

  test("scan detects new file between commits", async () => {
    const result = await scan(TMP_REPO, initialSHA);
    expect(result.currentSHA).toBe(secondSHA);
    expect(result.newFiles.length).toBe(1);
    expect(result.newFiles[0].path).toBe("ExampleApp/Sources/UI/Views/NoteDetailView.swift");
    expect(result.newFiles[0].status).toBe("A");
  });

  test("full pipeline: scan → parse → merge → validate", async () => {
    const { parseSwiftFile } = await import("./parse");
    const { merge } = await import("./merge");
    const { validate } = await import("./validate");

    const scanResult = await scan(TMP_REPO, initialSHA);

    // Parse all changed files
    const parsed = scanResult.newFiles.flatMap((f) => {
      const pv = parseSwiftFile(f.path, f.content);
      return pv ? [pv] : [];
    });

    expect(parsed.length).toBe(1);
    expect(parsed[0].structName).toBe("NoteDetailView");
    expect(parsed[0].inferredType).toBe("display");

    // Start with empty workflow
    const baseDefs: WorkflowDefs = { version: "1.0", generatedAt: "", journeys: [] };

    const mergeResult = merge(baseDefs, scanResult, parsed);
    expect(mergeResult.changes.length).toBeGreaterThan(0);
    expect(mergeResult.reviewCount).toBe(1);

    // The new step should be in a journey
    const allSteps = mergeResult.json.journeys.flatMap(j => j.steps);
    const detailStep = allSteps.find(s => s.screen === "NoteDetailView");
    expect(detailStep).toBeDefined();
    expect(detailStep?._needsReview).toBe(true);
    expect(detailStep?.type).toBe("display");

    // Validate
    const validation = validate(baseDefs, mergeResult.json);
    expect(validation.ok).toBe(true);
  });
});
