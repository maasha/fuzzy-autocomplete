import { describe, it } from "node:test";
import assert from "node:assert";
import { fuzzyScore } from "./fuzzy-score.ts";
import { tokenizeQuery } from "./tokenizer.ts";
import { scoreItemFuzzy, compareItemsByFuzzyScore } from "./item-scorer.ts";

describe("fuzzyScore", () => {
  it("matches exact string", () => {
    const r = fuzzyScore("abc", "abc", 0, "abc", "abc", 0, true);
    assert.ok(r);
    assert.deepStrictEqual(r.matches, [0, 1, 2]);
    assert.ok(r.score > 0);
  });

  it("matches non-contiguous subsequence", () => {
    const r = fuzzyScore("reme", "reme", 0, "read_me.txt", "read_me.txt", 0, true);
    assert.ok(r);
    assert.deepStrictEqual(r.matches, [0, 1, 5, 6]);
  });

  it("matches camelcase", () => {
    const r = fuzzyScore("upc", "upc", 0, "userProfileController.ts", "userprofilecontroller.ts", 0, true);
    assert.ok(r);
    assert.deepStrictEqual(r.matches, [0, 4, 11]);
  });

  it("returns undefined when no match", () => {
    const r = fuzzyScore("xyz", "xyz", 0, "read_me.txt", "read_me.txt", 0, true);
    assert.strictEqual(r, undefined);
  });

  it("prefers prefix matches", () => {
    const prefix = fuzzyScore("user", "user", 0, "userProfile.ts", "userprofile.ts", 0, true);
    const inline = fuzzyScore("user", "user", 0, "currentUserProfile.ts", "currentuserprofile.ts", 0, true);
    assert.ok(prefix);
    assert.ok(inline);
    assert.ok(prefix.score > inline.score, "prefix should score higher than inline");
  });

  it("prefers exact match over prefix", () => {
    const exact = fuzzyScore("abc", "abc", 0, "abc", "abc", 0, true);
    const prefix = fuzzyScore("abc", "abc", 0, "abcd", "abcd", 0, true);
    assert.ok(exact);
    assert.ok(prefix);
    assert.ok(exact.score > prefix.score, "exact should score higher than prefix");
  });

  it("prefers contiguous over gapped", () => {
    const contiguous = fuzzyScore("ctrl", "ctrl", 0, "controller.ts", "controller.ts", 0, true);
    const gapped = fuzzyScore("ctrl", "ctrl", 0, "myVeryLongFileWithCaaaTbbbRcccLddd.ts", "myverylongfilewithcaaatbbbbrccclddd.ts", 0, true);
    assert.ok(contiguous);
    assert.ok(gapped);
    assert.ok(contiguous.score > gapped.score, "contiguous should score higher than gapped");
  });

  it("prefers word boundary matches", () => {
    const boundary = fuzzyScore("pc", "pc", 0, "profile_controller.ts", "profile_controller.ts", 0, true);
    const midword = fuzzyScore("pc", "pc", 0, "some_deeply_nested_rpc.ts", "some_deeply_nested_rpc.ts", 0, true);
    assert.ok(boundary);
    assert.ok(midword);
    assert.ok(boundary.score > midword.score, "word boundary should score higher than mid-word");
  });

  it("is case-insensitive but rewards case-sensitive alignment", () => {
    const r1 = fuzzyScore("rpc", "rpc", 0, "ReadProfileController.ts", "readprofilecontroller.ts", 0, true);
    const r2 = fuzzyScore("rpc", "rpc", 0, "readprofilecontroller.ts", "readprofilecontroller.ts", 0, true);
    assert.ok(r1);
    assert.ok(r2);
    assert.ok(r1.score > r2.score, "case-sensitive alignment should score higher");
  });

  it("handles single-character query", () => {
    const start = fuzzyScore("r", "r", 0, "read_me.txt", "read_me.txt", 0, true);
    const mid = fuzzyScore("r", "r", 0, "index.ts", "index.ts", 0, true);
    assert.ok(start);
    assert.ok(start.score > (mid?.score ?? -Infinity), "start match should score higher");
  });

  it("handles query longer than candidate", () => {
    const r = fuzzyScore("abcdefgh", "abcdefgh", 0, "abc", "abc", 0, true);
    assert.strictEqual(r, undefined);
  });

  it("rejects weak first match when firstMatchCanBeWeak is false", () => {
    const strong = fuzzyScore("abc", "abc", 0, "abc", "abc", 0, false);
    const weak = fuzzyScore("bc", "bc", 0, "abc", "abc", 0, false);
    assert.ok(strong);
    assert.strictEqual(weak, undefined);
  });
});

describe("tokenizeQuery", () => {
  it("splits on whitespace", () => {
    const tokens = tokenizeQuery("user ctrl");
    assert.strictEqual(tokens.length, 2);
    assert.strictEqual(tokens[0].text, "user");
    assert.strictEqual(tokens[1].text, "ctrl");
    assert.strictEqual(tokens[0].mode, "fuzzy");
  });

  it("handles quoted exact tokens", () => {
    const tokens = tokenizeQuery('src "controller.ts"');
    assert.strictEqual(tokens.length, 2);
    assert.strictEqual(tokens[0].text, "src");
    assert.strictEqual(tokens[0].mode, "fuzzy");
    assert.strictEqual(tokens[1].text, "controller.ts");
    assert.strictEqual(tokens[1].mode, "exact");
  });

  it("ignores empty tokens", () => {
    const tokens = tokenizeQuery("  foo   bar  ");
    assert.strictEqual(tokens.length, 2);
  });
});

describe("scoreItemFuzzy", () => {
  it("scores a simple match", () => {
    const r = scoreItemFuzzy("read_me.txt", (s) => s, "reme");
    assert.ok(r);
    assert.ok(r.score > 0);
    assert.deepStrictEqual(r.matches, [0, 1, 5, 6]);
  });

  it("returns undefined for no match", () => {
    const r = scoreItemFuzzy("totally_unrelated_file.ts", (s) => s, "abc");
    assert.strictEqual(r, undefined);
  });

  it("requires all multi tokens to match", () => {
    const r1 = scoreItemFuzzy("userProfileController.ts", (s) => s, "user ctrl");
    const r2 = scoreItemFuzzy("userSettings.ts", (s) => s, "user ctrl");
    assert.ok(r1);
    assert.strictEqual(r2, undefined);
  });

  it("handles exact quoted tokens (case-sensitive)", () => {
    const r1 = scoreItemFuzzy("admin/controller.ts", (s) => s, '"controller.ts"');
    const r2 = scoreItemFuzzy("userProfileController.ts", (s) => s, '"controller.ts"');
    assert.ok(r1);
    // Case-sensitive exact match: "controller.ts" ≠ "Controller.ts"
    assert.strictEqual(r2, undefined);
  });

  it("handles mixed fuzzy and exact tokens", () => {
    const r1 = scoreItemFuzzy("src/admin/controller.ts", (s) => s, 'src "controller.ts"');
    const r2 = scoreItemFuzzy("admin/controller.ts", (s) => s, 'src "controller.ts"');
    const r3 = scoreItemFuzzy("src/userProfileController.ts", (s) => s, 'src "controller.ts"');
    assert.ok(r1);
    // admin/controller.ts lacks the "src" fuzzy token
    assert.strictEqual(r2, undefined);
    // Case-sensitive exact match: "Controller.ts" ≠ "controller.ts"
    assert.strictEqual(r3, undefined);
  });

  it("handles path-aware query tokens", () => {
    const r1 = scoreItemFuzzy("src/components/foo.ts", (s) => s, "src/foo");
    const r2 = scoreItemFuzzy("alpha/beta.ts", (s) => s, "a/b");
    assert.ok(r1);
    assert.ok(r2);
  });
});

describe("compareItemsByFuzzyScore", () => {
  const getText = (s: string) => s;

  it("sorts higher score first", () => {
    const a = { item: "a", score: 10, matches: [] };
    const b = { item: "b", score: 20, matches: [] };
    assert.ok(compareItemsByFuzzyScore(a, b, getText) > 0);
  });

  it("sorts shallower path first when scores tie", () => {
    const a = { item: "foo/bar.ts", score: 10, matches: [] };
    const b = { item: "baz.ts", score: 10, matches: [] };
    assert.ok(compareItemsByFuzzyScore(a, b, getText) > 0);
  });

  it("sorts shorter string first when depth ties", () => {
    const a = { item: "abc.ts", score: 10, matches: [] };
    const b = { item: "abcdef.ts", score: 10, matches: [] };
    assert.ok(compareItemsByFuzzyScore(a, b, getText) < 0);
  });
});
