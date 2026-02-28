/**
 * sync/scan.ts — Git-based Swift file inventory.
 *
 * Given a app repo path and a last-known SHA, returns which Swift files
 * in the watched directories were added, modified, or removed.
 */

// Watched path globs relative to app repo root
const WATCHED_GLOBS = [
  "ExampleApp/Sources/UI/Views/*.swift",
  "ExampleApp/Sources/UI/Onboarding/*.swift",
  "ExampleApp/Sources/UI/Components/*.swift",
  "ExampleApp/ContentView.swift",
  "ExampleApp/ExampleAppApp.swift",
  "ExampleAppShare/*.swift",
  "ExampleAppAction/*.swift",
];

export interface ChangedFile {
  path: string;
  content: string;
  diff: string;
  status: "A" | "M" | "D";
}

export interface ScanResult {
  currentSHA: string;
  newFiles: ChangedFile[];
  removedFiles: string[];
  modifiedFiles: ChangedFile[];
}

function isWatched(filePath: string): boolean {
  // Match against our watched path patterns
  return (
    filePath.match(/^ExampleApp\/Sources\/UI\/Views\/[^/]+\.swift$/) !== null ||
    filePath.match(/^ExampleApp\/Sources\/UI\/Onboarding\/[^/]+\.swift$/) !== null ||
    filePath.match(/^ExampleApp\/Sources\/UI\/Components\/[^/]+\.swift$/) !== null ||
    filePath === "ExampleApp/ContentView.swift" ||
    filePath === "ExampleApp/ExampleAppApp.swift" ||
    filePath.match(/^ExampleAppShare\/[^/]+\.swift$/) !== null ||
    filePath.match(/^ExampleAppAction\/[^/]+\.swift$/) !== null
  );
}

export async function scan(
  appPath: string,
  lastSHA: string | null
): Promise<ScanResult> {
  // Get current HEAD SHA
  const headResult = await Bun.$`git -C ${appPath} rev-parse HEAD`.quiet();
  const currentSHA = headResult.stdout.toString().trim();

  if (!lastSHA || lastSHA === currentSHA) {
    return { currentSHA, newFiles: [], removedFiles: [], modifiedFiles: [] };
  }

  // Get changed files between lastSHA and HEAD
  const diffResult = await Bun.$`git -C ${appPath} diff ${lastSHA}..HEAD --name-status -- "*.swift"`.quiet();
  const diffLines = diffResult.stdout.toString().trim().split("\n").filter(Boolean);

  const newFiles: ChangedFile[] = [];
  const removedFiles: string[] = [];
  const modifiedFiles: ChangedFile[] = [];

  for (const line of diffLines) {
    // Format: "A\tpath/to/file.swift" or "M\tpath" or "D\tpath"
    const [statusCode, ...pathParts] = line.split("\t");
    const filePath = pathParts.join("\t");
    if (!filePath || !isWatched(filePath)) continue;

    const status = statusCode.charAt(0) as "A" | "M" | "D";

    if (status === "D") {
      removedFiles.push(filePath);
      continue;
    }

    // Get file content (current HEAD)
    let content = "";
    try {
      const contentResult = await Bun.$`git -C ${appPath} show HEAD:${filePath}`.quiet();
      content = contentResult.stdout.toString();
    } catch {
      // File may not exist at HEAD if status is odd; skip
      continue;
    }

    // Get diff for this file
    let diff = "";
    try {
      const diffFileResult = await Bun.$`git -C ${appPath} diff ${lastSHA}..HEAD -- ${filePath}`.quiet();
      diff = diffFileResult.stdout.toString();
    } catch {
      diff = "";
    }

    const entry: ChangedFile = { path: filePath, content, diff, status };
    if (status === "A") {
      newFiles.push(entry);
    } else {
      modifiedFiles.push(entry);
    }
  }

  return { currentSHA, newFiles, removedFiles, modifiedFiles };
}
