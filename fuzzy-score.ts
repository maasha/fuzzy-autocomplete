// VS Code-style fuzzy scorer ported for Pi @-autocomplete.
// Based on src/vs/base/common/filters.ts (MIT License).

// ─── Constants ───────────────────────────────────────────────────────────────

export const scoreBase = 1;
export const scoreBonusBoundary = 4;
export const scoreBonusCamelCase = 4;
export const scoreBonusConsecutive = 5;
export const scoreBonusFirstMatch = 4;
export const scoreBonusPrefix = 9;
export const scoreBonusExact = 10;
export const penaltyGap = 1;
export const penaltyMax = 5;

export const NO_SCORE = Number.MIN_SAFE_INTEGER / 4;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FuzzyScore {
  score: number;
  matches: number[]; // absolute indices in candidate
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isSeparator(c: string): boolean {
  return c === "_" || c === "-" || c === "." || c === "/" || c === "\\" || c === " " || c === "\t";
}

function isDigit(c: string): boolean {
  return /\d/.test(c);
}

function isLetter(c: string): boolean {
  return /[a-zA-Z]/.test(c);
}

function isLower(c: string): boolean {
  return c === c.toLowerCase() && isLetter(c);
}

function isUpper(c: string): boolean {
  return c === c.toUpperCase() && isLetter(c);
}

/**
 * True when prev is a lowercase letter and curr is an uppercase letter,
 * indicating a CamelCase boundary.
 */
function isLowerToUpper(prev: string, curr: string): boolean {
  return isLower(prev) && isUpper(curr);
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

  if (isSeparator(prev)) {
    return scoreBonusBoundary;
  }

  if (isLowerToUpper(prev, curr)) {
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

  const scores: number[][] = Array.from({ length: queryLen }, () =>
    new Array(candidateLen).fill(NO_SCORE)
  );

  const back: number[][] = Array.from({ length: queryLen }, () =>
    new Array(candidateLen).fill(-1)
  );

  // ── Row 0 ──
  const q0 = queryLower[queryPos];
  let foundAny = false;
  for (let j = 0; j < candidateLen; j++) {
    if (candidateLower[candidatePos + j] === q0) {
      // When firstMatchCanBeWeak is false, the first match must be at a
      // strong position (word/path boundary) to be considered valid.
      if (!firstMatchCanBeWeak && bonuses[j] === 0) {
        continue;
      }
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

    let bestPrev = NO_SCORE;
    let bestPrevIdx = -1;

    for (let j = 0; j < candidateLen; j++) {
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

  // Prefix / Exact bonuses
  if (
    queryLen <= candidateLen &&
    candidateLower.substring(candidatePos, candidatePos + queryLen) ===
      queryLower.substring(queryPos, queryPos + queryLen)
  ) {
    bestScore += scoreBonusPrefix;
  }

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

  // Case-sensitive alignment bonus
  let caseBonus = 0;
  for (let i = 0; i < queryLen; i++) {
    if (query[queryPos + i] === candidate[matches[i]]) {
      caseBonus += 1;
    }
  }
  bestScore += caseBonus;

  return { score: bestScore, matches };
}

// ─── Path-Aware Scoring ──────────────────────────────────────────────────────

export function scorePathAware(
  query: string,
  queryLower: string,
  candidate: string,
  candidateLower: string
): FuzzyScore | undefined {
  const segments = query.split(/[\/\\]+/).filter((s) => s.length > 0);
  const segmentsLower = queryLower.split(/[\/\\]+/).filter((s) => s.length > 0);

  if (segments.length === 0) {
    return { score: 0, matches: [] };
  }

  if (segments.length === 1) {
    return fuzzyScore(query, queryLower, 0, candidate, candidateLower, 0, true);
  }

  let totalScore = 0;
  const allMatches: number[] = [];
  let candidatePos = 0;

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const segLower = segmentsLower[s];
    const result = fuzzyScore(seg, segLower, 0, candidate, candidateLower, candidatePos, true);
    if (!result) {
      return undefined;
    }

    totalScore += result.score;

    const firstMatch = result.matches[0];
    const lastMatch = result.matches[result.matches.length - 1];

    // Bonus when segment starts at a path/word boundary
    if (firstMatch === 0 || isSeparator(candidate[firstMatch - 1])) {
      totalScore += scoreBonusBoundary;
    }

    // Bonus when segment matches a whole path segment exactly
    const afterLast = lastMatch + 1;
    if (
      (afterLast >= candidate.length || isSeparator(candidate[afterLast])) &&
      (firstMatch === 0 || isSeparator(candidate[firstMatch - 1]))
    ) {
      totalScore += scoreBonusExact;
    }

    allMatches.push(...result.matches);
    candidatePos = lastMatch + 1;
  }

  return { score: totalScore, matches: allMatches };
}
