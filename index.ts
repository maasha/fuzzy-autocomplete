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
} from "./item-scorer.ts";

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLabel(text: string, matches: number[]): string {
  const set = new Set(matches);
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";
  let result = "";
  let inBold = false;
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i);
    if (isMatch && !inBold) {
      result += bold;
      inBold = true;
    } else if (!isMatch && inBold) {
      result += reset;
      inBold = false;
    }
    result += text[i];
  }
  if (inBold) result += reset;
  return result;
}

// ─── Provider Factory ──────────────────────────────────────────────────────────

export function extractAtPrefix(textBeforeCursor: string): string | undefined {
  const match = textBeforeCursor.match(/(?:^|[ \t])@(.*)$/);
  return match?.[1]?.trim();
}

export function createFuzzyAutocompleteProvider(
  current: AutocompleteProvider,
  pi: ExtensionAPI,
  cwd: string
): AutocompleteProvider
{
  let fileCache: FileCache | undefined;

  async function tryExec(
    command: string,
    args: string[]
  ): Promise<string[] | undefined>
  {
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

  async function getProjectFiles(): Promise<string[]>
  {
    if (
      fileCache &&
      fileCache.cwd === cwd &&
      Date.now() - fileCache.timestamp < FILE_CACHE_TTL_MS
    ) {
      return fileCache.files;
    }

    let files: string[] | undefined;

    files = await tryExec("fd", ["--type", "f", "--strip-cwd-prefix"]);

    if (!files) {
      files = await tryExec("fdfind", ["--type", "f", "--strip-cwd-prefix"]);
    }

    if (!files) {
      const findResult = await tryExec("find", [".", "-type", "f"]);
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

  return {
    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options
    ): Promise<AutocompleteSuggestions | null>
    {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);
      const token = extractAtPrefix(textBeforeCursor);

      // Not an @-prefix query — delegate to the built-in provider.
      if (token === undefined) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const files = await getProjectFiles();

      // Fallback to built-in provider if we couldn't discover files.
      if (options.signal.aborted || files.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      // Empty query: return alphabetically sorted files, unfiltered.
      if (token === "") {
        const items: AutocompleteItem[] = files
          .sort((a, b) => a.localeCompare(b))
          .slice(0, MAX_SUGGESTIONS)
          .map((f) => ({ value: f, label: f }));
        return {
          items,
          prefix: "@",
        };
      }

      const scored: ScoredItem<string>[] = [];
      const CULL_THRESHOLD = MAX_SUGGESTIONS * 10;
      const KEEP_AFTER_CULL = MAX_SUGGESTIONS * 2;

      for (const file of files) {
        const result = scoreItemFuzzy(file, (f) => f, token);
        if (result) {
          scored.push(result);
          if (scored.length > CULL_THRESHOLD) {
            scored.sort((a, b) => compareItemsByFuzzyScore(a, b, (f) => f));
            scored.length = KEEP_AFTER_CULL;
          }
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
          label: s.matches.length > 0 ? formatLabel(s.item, s.matches) : s.item,
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
  pi.registerCommand("fuzzy-status", {
    description: "Check if fuzzy autocomplete extension is loaded",
    handler: async (_name, ctx) => {
      ctx.ui.notify("Fuzzy autocomplete extension is loaded!", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) =>
      createFuzzyAutocompleteProvider(current, pi, ctx.cwd)
    );
  });
}
