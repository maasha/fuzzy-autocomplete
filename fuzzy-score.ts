// VS Code-style fuzzy scorer ported for Pi @-autocomplete.
// Based on src/vs/base/common/filters.ts (MIT License).

// ─── Constants ───────────────────────────────────────────────────────────────

const scoreBase = 1;
const scoreBonusBoundary = 4;
const scoreBonusCamelCase = 4;
const scoreBonusConsecutive = 5;
const scoreBonusFirstMatch = 4;
const scoreBonusPrefix = 9;
const scoreBonusExact = 10;
const penaltyGap = 1;
const penaltyMax = 5;

const NO_SCORE = Number.MIN_SAFE_INTEGER / 4;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FuzzyScore {
  score: number;
  matches: number[]; // absolute indices in candidate
}

export interface ScoredItem<T> {
  item: T;
  score: number;
  matches: number[];
}

export type TokenMode = "fuzzy" | "exact";

export interface QueryToken {
  text: string;
  textLower: string;
  mode: TokenMode;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isSeparator(c: string): boolean {
  return c === "_" || c === "-" || c === "." || c === "/" || c === "\\" || c === " " || c === "\t";
}

function isDigit(c: string): boolean {
  return /\d/.test(c);
}

function isLetter(c: string): boolean {
  return /[a-zA-Z]/.test(c);
}

function isLowerToUpper(
  prev: string,
  prevLower: string,
  curr: string,
  currLower: string
): boolean {
  return prevLower === prev && currLower !== curr;
}

function computeMatchBonus(
  candidate: string,
  candidateLower: string,
  pos: number
): number {
  if (pos === 0) {
    return scoreBonusBoundary;
  }
  const prev = candidate[pos - 1];
  const curr = candidate[pos];
  const prevLower = candidateLower[pos - 1];
  const currLower = candidateLower[pos];

  if (isSeparator(prev)) {
    return scoreBonusBoundary;
  }

  if (isLowerToUpper(prev, prevLower, curr, currLower)) {
    return scoreBonusCamelCase;
  }

  if (
    (isDigit(prev) && isLetter(curr)) ||
    (isLetter(prev) && isDigit(curr))
  ) {
    return scoreBonusBoundary;
  }

  return 0;
}

// ─── Core DP Scorer ──────────────────────────────────────────────────────────

export function fuzzyScore(
  query: string,
  queryLower: string,
  queryPos: number,
  candidate: string,
  candidateLower: string,
  candidatePos: number,
  firstMatchCanBeWeak: boolean
): FuzzyScore | undefined {
  const queryLen = query.length - queryPos;
  const candidateLen = candidate.length - candidatePos;

  if (queryLen === 0) {
    return { score: 0, matches: [] };
  }

  if (candidateLen < queryLen) {
    return undefined;
  }

  // Precompute bonuses for each candidate position.
  const bonuses = new Array(candidateLen);
  for (let i = 0; i < candidateLen; i++) {
    bonuses[i] = computeMatchBonus(candidate, candidateLower, candidatePos + i);
  }

  // scores[i][j] = best score for matching query[0..i] ending at candidate[j]
  const scores: number[][] = Array.from({ length: queryLen }, () =>
    new Array(candidateLen).fill(NO_SCORE)
  );

  // back[i][j] = previous candidate position used for best score
  const back: number[][] = Array.from({ length: queryLen }, () =>
    new Array(candidateLen).fill(-1)
  );

  // ── Row 0 ──
  const q0 = queryLower[queryPos];
  let foundAny = false;
  for (let j = 0; j < candidateLen; j++) {
    if (candidateLower[candidatePos + j] === q0) {
      let score = scoreBase + bonuses[j];
      if (
        j === 0 &&
        query[queryPos] === candidate[candidatePos]
      ) {
        score += scoreBonusFirstMatch;
      }
      scores[0][j] = score;
      foundAny = true;
    }
  }

  if (!foundAny) return undefined;

  // ── Rows 1..queryLen-1 ──
  for (let i = 1; i < queryLen; i++) {
    const qi = queryLower[queryPos + i];
    let rowFound = false;

    // Running maximum of previous row up to position j-2.
    // Position j-1 is handled separately for the consecutive bonus.
    let bestPrev = NO_SCORE;
    let bestPrevIdx = -1;

    for (let j = 0; j < candidateLen; j++) {
      // Update running max with previous row at position j-2
      if (j > 1 && scores[i - 1][j - 2] > bestPrev) {
        bestPrev = scores[i - 1][j - 2];
        bestPrevIdx = j - 2;
      }

      if (candidateLower[candidatePos + j] === qi) {
        let bestScoreForJ = NO_SCORE;
        let bestPrevForJ = -1;

        // Option 1: consecutive match at j-1
        if (j > 0 && scores[i - 1][j - 1] > NO_SCORE) {
          const s =
            scores[i - 1][j - 1] +
            scoreBase +
            bonuses[j] +
            scoreBonusConsecutive;
          if (s > bestScoreForJ) {
            bestScoreForJ = s;
            bestPrevForJ = j - 1;
          }
        }

        // Option 2: best previous match anywhere before j-1
        if (bestPrevIdx >= 0) {
          const gap = j - bestPrevIdx - 1;
          const s =
            bestPrev +
            scoreBase +
            bonuses[j] -
            Math.min(gap, penaltyMax) * penaltyGap;
          if (s > bestScoreForJ) {
            bestScoreForJ = s;
            bestPrevForJ = bestPrevIdx;
          }
        }

        if (bestPrevForJ >= 0) {
          scores[i][j] = bestScoreForJ;
          back[i][j] = bestPrevForJ;
          rowFound = true;
        }
      }
    }

    if (!rowFound) return undefined;
  }

  // ── Find best ending position ──
  let bestScore = NO_SCORE;
  let bestJ = -1;
  for (let j = 0; j < candidateLen; j++) {
    if (scores[queryLen - 1][j] > bestScore) {
      bestScore = scores[queryLen - 1][j];
      bestJ = j;
    }
  }

  if (bestJ < 0) return undefined;

  // ── Prefix / Exact bonuses ──
  // Full prefix match: query matches start of candidate exactly
  if (
    queryLen <= candidateLen &&
    candidateLower.substring(candidatePos, candidatePos + queryLen) ===
      queryLower.substring(queryPos, queryPos + queryLen)
  ) {
    bestScore += scoreBonusPrefix;
  }

  // Exact match: query equals candidate (full string, case-insensitive)
  if (
    queryLen === candidateLen &&
    candidateLower.substring(candidatePos, candidatePos + queryLen) ===
      queryLower.substring(queryPos, queryPos + queryLen)
  ) {
    bestScore += scoreBonusExact;
  }

  // ── Backtrack to collect match positions ──
  const matches = new Array<number>(queryLen);
  let j = bestJ;
  for (let i = queryLen - 1; i >= 0; i--) {
    matches[i] = candidatePos + j;
    j = back[i][j];
  }

  // Case-sensitive alignment bonus: for each matched position where the
  // original case matches, add a tiny bonus.
  let caseBonus = 0;
  for (let i = 0; i < queryLen; i++) {
    if (query[queryPos + i] === candidate[matches[i]]) {
      caseBonus += 1;
    }
  }
  bestScore += caseBonus;

  return { score: bestScore, matches };
}

// ─── Tokenization ────────────────────────────────────────────────────────────

export function tokenizeQuery(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let i = 0;

  while (i < query.length) {
    // Skip whitespace
    while (i < query.length && /\s/.test(query[i])) i++;
    if (i >= query.length) break;

    if (query[i] === '"') {
      // Quoted exact token
      let j = i + 1;
      while (j < query.length && query[j] !== '"') j++;
      const text = query.slice(i + 1, j);
      if (text.length > 0) {
        tokens.push({ text, textLower: text.toLowerCase(), mode: "exact" });
      }
      i = j + 1;
    } else {
      // Fuzzy token
      let j = i;
      while (j < query.length && !/\s/.test(query[j])) j++;
      const text = query.slice(i, j);
      if (text.length > 0) {
        tokens.push({ text, textLower: text.toLowerCase(), mode: "fuzzy" });
      }
      i = j;
    }
  }

  return tokens;
}

// ─── Item Scoring ──────────────────────────────────────────────────────────────

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
): ScoredItem<T> | undefined {
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
      if (!textLower.includes(token.textLower)) {
        return undefined;
      }
      totalScore += scoreBonusExact;
      // Add match positions for exact substring (first occurrence)
      const idx = textLower.indexOf(token.textLower);
      for (let k = 0; k < token.text.length; k++) {
        allMatches.push(idx + k);
      }
    } else {
      // Fast path: reject candidates that don't contain all query chars in order.
      if (!containsAllChars(textLower, token.textLower)) {
        return undefined;
      }
      const result = fuzzyScore(
        token.text,
        token.textLower,
        0,
        text,
        textLower,
        0,
        true
      );
      if (!result) {
        return undefined;
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

// ─── Comparator ────────────────────────────────────────────────────────────────

export function compareItemsByFuzzyScore<T>(
  a: ScoredItem<T>,
  b: ScoredItem<T>,
  getText: (item: T) => string
): number {
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
