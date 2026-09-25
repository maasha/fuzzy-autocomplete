export type TokenMode = "fuzzy" | "exact";

export interface QueryToken {
  text: string;
  textLower: string;
  mode: TokenMode;
}

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
