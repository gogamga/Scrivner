/**
 * lib/logger.ts — NDJSON structured logger with rotation.
 *
 * - Primary log: logs/woviz-daemon.log (5MB, keep 2 rotations)
 * - Error log:   logs/woviz-errors.log (ERROR severity only)
 * - Also writes to stdout
 */

import { join } from "path";
import { existsSync, statSync, renameSync, unlinkSync } from "node:fs";

const DIR = import.meta.dir + "/..";
const LOG_DIR = join(DIR, "logs");
const MAIN_LOG = join(LOG_DIR, "woviz-daemon.log");
const ERR_LOG = join(LOG_DIR, "woviz-errors.log");

const MAX_BYTES = Number(process.env.LOG_MAX_BYTES) || 5_242_880; // 5MB
const KEEP = 2;

export type Severity = "INFO" | "WARN" | "ERROR" | "DEBUG";

export type EventName =
  | "POLL_TICK"
  | "COMMIT_DETECTED"
  | "SCAN_COMPLETE"
  | "MERGE_APPLIED"
  | "UPDATE_SKIPPED"
  | "VALIDATION_FAILED"
  | "ERROR"
  | "DAEMON_START"
  | "DAEMON_STOP";

export interface LogEntry {
  ts: string;
  event: EventName;
  severity: Severity;
  commit?: string;
  files?: string[];
  changes?: number;
  pendingReview?: number;
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
}

function ensureLogsDir() {
  if (!existsSync(LOG_DIR)) {
    const { mkdirSync } = require("node:fs");
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function rotate(path: string) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.size < MAX_BYTES) return;

  // Shift rotations: .2 deleted, .1 → .2, current → .1
  const r2 = path + ".2";
  const r1 = path + ".1";
  if (existsSync(r2)) unlinkSync(r2);
  if (existsSync(r1)) renameSync(r1, r2);
  renameSync(path, r1);
}

async function appendLine(path: string, line: string) {
  rotate(path);
  await Bun.write(Bun.file(path), line + "\n", { append: true } as any);
}

export async function log(entry: Omit<LogEntry, "ts">) {
  ensureLogsDir();
  const full: LogEntry = { ts: new Date().toISOString(), ...entry } as LogEntry;
  const line = JSON.stringify(full);

  // stdout
  process.stdout.write(line + "\n");

  // main log
  await appendLine(MAIN_LOG, line);

  // errors log
  if (full.severity === "ERROR") {
    await appendLine(ERR_LOG, line);
  }
}

// Convenience wrappers
export const logger = {
  info: (event: EventName, fields: Partial<LogEntry> = {}) =>
    log({ event, severity: "INFO", ...fields }),
  warn: (event: EventName, fields: Partial<LogEntry> = {}) =>
    log({ event, severity: "WARN", ...fields }),
  error: (event: EventName, fields: Partial<LogEntry> = {}) =>
    log({ event, severity: "ERROR", ...fields }),
  debug: (event: EventName, fields: Partial<LogEntry> = {}) =>
    log({ event, severity: "DEBUG", ...fields }),
};
