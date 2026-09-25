import {
  fuzzyScore,
  scorePathAware,
  scoreBonusExact,
} from "./fuzzy-score.ts";
import { tokenizeQuery } from "./tokenizer.ts";

export interface ScoredItem<T>
{
  item: T;
  score: number;
  matches: number[];
}

function containsAllChars(candidate: string, query: string): boolean {
  let i = 0;
  for (const c of candidate) {
    if (c === query[i]) {
      i++;
      if (i === query.length) return true;
    }
  }
  return false;
}

export function scoreItemFuzzy<T>(
  item: T,
  getText: (item: T) => string,
  query: string
): ScoredItem<T>
{
  const text = getText(item);
  const textLower = text.toLowerCase();
  const tokens = tokenizeQuery(query);

  if (tokens.length === 0) {
    return { item, score: 0, matches: [] };
  }

  let totalScore = 0;
  const allMatches: number[] = [];

  for (const token of tokens) {
    if (token.mode === "exact") {
      // Case-sensitive exact substring match
      if (!text.includes(token.text)) {
        return undefined as unknown as ScoredItem<T>;
      }
      totalScore += scoreBonusExact;
      const idx = text.indexOf(token.text);
      for (let k = 0; k < token.text.length; k++) {
        allMatches.push(idx + k);
      }
    } else {
      // Path-aware matching for tokens containing / or \
      const hasPathSep = token.text.includes("/") || token.text.includes("\\");
      if (!hasPathSep) {
        // Fast path: reject candidates that don't contain all query chars in order.
        if (!containsAllChars(textLower, token.textLower)) {
          return undefined as unknown as ScoredItem<T>;
        }
      }
      const result = hasPathSep
        ? scorePathAware(token.text, token.textLower, text, textLower)
        : fuzzyScore(token.text, token.textLower, 0, text, textLower, 0, true);
      if (!result) {
        return undefined as unknown as ScoredItem<T>;
      }
      totalScore += result.score;
      for (const pos of result.matches) {
        if (!allMatches.includes(pos)) {
          allMatches.push(pos);
        }
      }
    }
  }

  allMatches.sort((a, b) => a - b);

  return { item, score: totalScore, matches: allMatches };
}

export function compareItemsByFuzzyScore<T>(
  a: ScoredItem<T>,
  b: ScoredItem<T>,
  getText: (item: T) => string
): number
{
  // 1. Higher score first
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  const textA = getText(a.item);
  const textB = getText(b.item);

  // 2. Shallower path depth first
  const depthA = (textA.match(/[\/\\]/g) || []).length;
  const depthB = (textB.match(/[\/\\]/g) || []).length;
  if (depthA !== depthB) {
    return depthA - depthB;
  }

  // 3. Shorter overall string first
  if (textA.length !== textB.length) {
    return textA.length - textB.length;
  }

  // 4. Lexicographic tie-breaker
  return textA.localeCompare(textB);
}
