# Workflow Viz GUI Tool

An interactive node-graph editor for visualizing and annotating iOS app user journeys. Runs locally via Bun, with an optional daemon that auto-syncs workflow definitions by watching a companion app's git repo for Swift file changes.

## Features

- Visual workflow editor with zoom, pan, and node highlighting
- Annotate steps with notes, change requests, bugs, and questions
- Export workflows to Mermaid diagram syntax
- Auto-sync daemon that detects Swift file changes via git polling
- Prioritized annotation review reports

## Setup

```bash
bun install
```

Copy the example env file and configure it:

```bash
cp .env.example .env
```

Edit `.env` and set `APP_REPO_PATH` to the local path of the iOS app's git repo.

## Running

**Editor only** (no auto-sync):

```bash
bun --hot server.ts
# http://localhost:8091
```

**Editor + auto-sync daemon**:

```bash
APP_REPO_PATH=/path/to/your/app/repo bun --hot daemon.ts
# http://localhost:8091
```

**Export workflows to Mermaid:**

```bash
bun export-mermaid.ts                  # all journeys
bun export-mermaid.ts first-launch     # single journey
```

**Generate annotation review report:**

```bash
bun review-annotations.ts             # text report
bun review-annotations.ts --json      # JSON report
bun review-annotations.ts --check-files  # verify Swift files exist on disk
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_REPO_PATH` | *(required for daemon)* | Path to the companion iOS app's git repo |
| `POLL_INTERVAL_SECONDS` | `60` | How often the daemon polls for git changes |
| `WOVIZ_PORT` | `8091` | Port the server listens on |
| `LOG_MAX_BYTES` | `5242880` | Max log file size before rotation (5 MB) |

## Project Structure

| File | Purpose |
|------|---------|
| `workflow-defs.json` | Journey and step definitions |
| `annotations.json` | Persisted annotations (created at runtime) |
| `editor.tsx` | React frontend: canvas, nodes, annotation panel |
| `editor.css` | Styles: nodes, connectors, zoom toolbar |
| `editor.html` | HTML shell |
| `server.ts` | Bun HTTP server + REST API |
| `daemon.ts` | server.ts + git polling loop |
| `export-mermaid.ts` | CLI: convert journeys to Mermaid syntax |
| `review-annotations.ts` | CLI: prioritized annotation review report |
| `baseline.ts` | Snapshot system for workflow-defs.json |
| `sync/` | Git scanning, Swift parsing, merge logic |
