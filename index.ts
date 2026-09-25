import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import {
  scoreItemFuzzy,
  compareItemsByFuzzyScore,
  type ScoredItem,
} from "./fuzzy-score.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_SUGGESTIONS = 20;
const FILE_CACHE_TTL_MS = 30_000;
const MAX_FILE_LIST_SIZE = 100_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileCache {
  files: string[];
  cwd: string;
  timestamp: number;
}

// ─── File Discovery ──────────────────────────────────────────────────────────

let fileCache: FileCache | undefined;

async function tryExec(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  cwd: string
): Promise<string[] | undefined> {
  try {
    const result = await pi.exec(command, args, { cwd, timeout: 5_000 });
    if (result.code === 0) {
      return result.stdout.split("\n").filter((f) => f.length > 0);
    }
  } catch {
    // Command not found or execution failed — treat as no results.
  }
  return undefined;
}

async function getProjectFiles(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  if (
    fileCache &&
    fileCache.cwd === cwd &&
    Date.now() - fileCache.timestamp < FILE_CACHE_TTL_MS
  ) {
    return fileCache.files;
  }

  let files: string[] | undefined;

  // Try `fd` (modern replacement for find)
  files = await tryExec(pi, "fd", ["--type", "f", "--strip-cwd-prefix"], cwd);

  if (!files) {
    // Some distros install fd as fdfind
    files = await tryExec(pi, "fdfind", ["--type", "f", "--strip-cwd-prefix"], cwd);
  }

  if (!files) {
    // Fallback to standard `find`
    const findResult = await tryExec(pi, "find", [".", "-type", "f"], cwd);
    if (findResult) {
      files = findResult.map((f) => f.replace(/^\.\//, ""));
    }
  }

  if (!files) {
    files = [];
  }

  if (files.length > MAX_FILE_LIST_SIZE) {
    files = files.slice(0, MAX_FILE_LIST_SIZE);
  }

  fileCache = { files, cwd, timestamp: Date.now() };
  return files;
}

// ─── Provider Factory ──────────────────────────────────────────────────────────

function extractAtPrefix(textBeforeCursor: string): string | undefined {
  const match = textBeforeCursor.match(/(?:^|[ \t])@(.*)$/);
  return match?.[1]?.trim();
}

function createFuzzyAutocompleteProvider(
  current: AutocompleteProvider,
  pi: ExtensionAPI,
  cwd: string
): AutocompleteProvider {
  return {
    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);
      const token = extractAtPrefix(textBeforeCursor);

      // Not an @-prefix query — delegate to the built-in provider.
      if (token === undefined) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const files = await getProjectFiles(pi, cwd);

      // Fallback to built-in provider if we couldn't discover files.
      if (options.signal.aborted || files.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const scored: ScoredItem<string>[] = [];
      for (const file of files) {
        const result = scoreItemFuzzy(file, (f) => f, token);
        if (result) {
          scored.push(result);
        }
      }

      // Fallback when our scorer rejects everything.
      if (scored.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      scored.sort((a, b) => compareItemsByFuzzyScore(a, b, (f) => f));

      const items: AutocompleteItem[] = scored
        .slice(0, MAX_SUGGESTIONS)
        .map((s) => ({
          value: s.item,
          label: s.item,
        }));

      return {
        items,
        prefix: `@${token}`,
      };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return (
        current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
        true
      );
    },
  };
}

// ─── Extension Entry Point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) =>
      createFuzzyAutocompleteProvider(current, pi, ctx.cwd)
    );
  });
}
