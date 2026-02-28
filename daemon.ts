/**
 * daemon.ts — Auto-sync daemon entry point.
 *
 * Extends server.ts: adds GET /api/daemon/status and a poll loop that watches
 * the companion app's git repo for Swift file changes.
 *
 * Usage: bun --hot daemon.ts
 * Env:   APP_REPO_PATH, POLL_INTERVAL_SECONDS, WOVIZ_PORT, LOG_MAX_BYTES
 */

import editor from "./editor.html";
import { join } from "path";
import { logger } from "./lib/logger";
import { scan } from "./sync/scan";
import { parseSwiftFile } from "./sync/parse";
import { merge } from "./sync/merge";
import { validate } from "./sync/validate";

const DIR = import.meta.dir;
const WORKFLOWS_PATH = join(DIR, "workflow-defs.json");
const ANNOTATIONS_PATH = join(DIR, "annotations.json");
const LAST_COMMIT_PATH = join(DIR, "sync/.last-commit");

const APP_REPO_PATH = process.env.APP_REPO_PATH;
if (!APP_REPO_PATH) {
  throw new Error("APP_REPO_PATH environment variable is required. Set it to the path of your app's git repo.");
}
const POLL_INTERVAL_MS = (Number(process.env.POLL_INTERVAL_SECONDS) || 60) * 1000;
const PORT = Number(process.env.WOVIZ_PORT) || 8091;

// ── Daemon state ──────────────────────────────────────────────────

interface DaemonState {
  status: "running" | "paused" | "error";
  lastCommit: string | null;
  lastCheck: string | null;
  lastUpdate: string | null;
  pollInterval: number;
  updatesApplied: number;
  pendingReview: number;
  consecutiveErrors: number;
}

const state: DaemonState = {
  status: "running",
  lastCommit: null,
  lastCheck: null,
  lastUpdate: null,
  pollInterval: POLL_INTERVAL_MS,
  updatesApplied: 0,
  pendingReview: 0,
  consecutiveErrors: 0,
};

// ── Persist / load last commit SHA ────────────────────────────────

async function loadLastCommit(): Promise<string | null> {
  const f = Bun.file(LAST_COMMIT_PATH);
  if (!(await f.exists())) return null;
  return (await f.text()).trim() || null;
}

async function saveLastCommit(sha: string) {
  await Bun.write(LAST_COMMIT_PATH, sha);
}

// ── Poll cycle ────────────────────────────────────────────────────

async function pollCycle() {
  const cycleStart = Date.now();
  state.lastCheck = new Date().toISOString();

  await logger.info("POLL_TICK", { commit: state.lastCommit ?? undefined });

  try {
    // 1. Scan git for changes
    const scanResult = await scan(APP_REPO_PATH, state.lastCommit);
    const totalChanged =
      scanResult.newFiles.length +
      scanResult.removedFiles.length +
      scanResult.modifiedFiles.length;

    if (totalChanged === 0) {
      await logger.info("UPDATE_SKIPPED", {
        commit: scanResult.currentSHA,
        durationMs: Date.now() - cycleStart,
      });
      state.lastCommit = scanResult.currentSHA;
      await saveLastCommit(scanResult.currentSHA);
      state.consecutiveErrors = 0;
      return;
    }

    await logger.info("COMMIT_DETECTED", {
      commit: scanResult.currentSHA,
      files: [
        ...scanResult.newFiles.map((f) => f.path),
        ...scanResult.removedFiles,
        ...scanResult.modifiedFiles.map((f) => f.path),
      ],
      changes: totalChanged,
    });

    // 2. Parse Swift files
    const allFiles = [...scanResult.newFiles, ...scanResult.modifiedFiles];
    const parsedViews = allFiles
      .map((f) => parseSwiftFile(f.path, f.content))
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // 3. Load current workflow defs
    const workflowsFile = Bun.file(WORKFLOWS_PATH);
    const currentDefs = (await workflowsFile.exists())
      ? await workflowsFile.json()
      : { version: "1.0.0", generatedAt: new Date().toISOString(), journeys: [] };

    // 4. Merge
    const mergeResult = merge(currentDefs, scanResult, parsedViews);

    await logger.info("SCAN_COMPLETE", {
      commit: scanResult.currentSHA,
      changes: mergeResult.changes.length,
      pendingReview: mergeResult.reviewCount,
    });

    // 5. Validate
    const validation = validate(currentDefs, mergeResult.json);
    if (!validation.ok) {
      await logger.warn("VALIDATION_FAILED", {
        commit: scanResult.currentSHA,
        error: validation.errors.join("; "),
      });
      state.consecutiveErrors++;
      checkErrorThreshold();
      return;
    }

    // 6. Save baseline snapshot before writing
    try {
      await Bun.$`bun ${join(DIR, "baseline.ts")} save`.quiet();
    } catch {
      // Non-fatal — log and continue
      await logger.warn("ERROR", { error: "baseline save failed (non-fatal)" });
    }

    // 7. Write updated workflow-defs.json
    const updated = {
      ...mergeResult.json,
      generatedAt: new Date().toISOString(),
    };
    await Bun.write(WORKFLOWS_PATH, JSON.stringify(updated, null, 2));

    // 8. Export mermaid (non-fatal if it fails)
    try {
      await Bun.$`bun ${join(DIR, "export-mermaid.ts")} --json`.quiet();
    } catch {
      await logger.warn("ERROR", { error: "mermaid export failed (non-fatal)" });
    }

    // 9. Update state
    state.lastCommit = scanResult.currentSHA;
    state.lastUpdate = new Date().toISOString();
    state.updatesApplied++;
    state.pendingReview += mergeResult.reviewCount;
    state.consecutiveErrors = 0;
    await saveLastCommit(scanResult.currentSHA);

    await logger.info("MERGE_APPLIED", {
      commit: scanResult.currentSHA,
      changes: mergeResult.changes.length,
      pendingReview: state.pendingReview,
      durationMs: Date.now() - cycleStart,
    });
  } catch (err: any) {
    state.consecutiveErrors++;
    await logger.error("ERROR", {
      error: String(err?.message || err),
      durationMs: Date.now() - cycleStart,
    });
    checkErrorThreshold();
  }
}

function checkErrorThreshold() {
  if (state.consecutiveErrors >= 5) {
    state.status = "paused";
    logger.warn("ERROR", { error: `Pausing for 10min after ${state.consecutiveErrors} consecutive errors` });
    setTimeout(() => {
      state.status = "running";
      state.consecutiveErrors = 0;
      startPoll();
    }, 10 * 60 * 1000);
  }
}

// ── Poll loop ─────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setTimeout> | null = null;

function startPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const tick = async () => {
    if (state.status === "running") {
      await pollCycle();
    }
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
  };
  pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
}

// ── HTTP server (extends server.ts routes) ────────────────────────

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  routes: {
    "/": editor,
  },

  async fetch(req) {
    const url = new URL(req.url);

    // Daemon status endpoint
    if (url.pathname === "/api/daemon/status" && req.method === "GET") {
      return Response.json(state);
    }

    // Workflow CRUD (from server.ts)
    if (url.pathname === "/api/workflows") {
      if (req.method === "GET") {
        const file = Bun.file(WORKFLOWS_PATH);
        if (await file.exists()) {
          return new Response(await file.text(), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return Response.json({ version: "1.0.0", journeys: [] });
      }
      if (req.method === "PUT") {
        const body = await req.json();
        await Bun.write(WORKFLOWS_PATH, JSON.stringify(body, null, 2));
        return Response.json({ ok: true });
      }
    }

    // Annotations CRUD (from server.ts)
    if (url.pathname === "/api/annotations") {
      if (req.method === "GET") {
        const file = Bun.file(ANNOTATIONS_PATH);
        if (await file.exists()) {
          return new Response(await file.text(), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return Response.json({ annotations: [] });
      }
      if (req.method === "POST") {
        const body = await req.json();
        await Bun.write(ANNOTATIONS_PATH, JSON.stringify(body, null, 2));
        return Response.json({ ok: true });
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  development: {
    hmr: true,
    console: true,
  },
});

// ── Boot ──────────────────────────────────────────────────────────

state.lastCommit = await loadLastCommit();
await logger.info("DAEMON_START", {
  commit: state.lastCommit ?? undefined,
});

startPoll();

console.log(`Workflow Editor + Daemon running at http://localhost:${server.port}`);
console.log(`Watching: ${APP_REPO_PATH}`);
console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log(`Last commit: ${state.lastCommit ?? "(none — full scan on next poll)"}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  await logger.info("DAEMON_STOP", {});
  if (pollTimer) clearTimeout(pollTimer);
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await logger.info("DAEMON_STOP", {});
  if (pollTimer) clearTimeout(pollTimer);
  process.exit(0);
});
