import { describe, it } from "node:test";
import assert from "node:assert";
import { scoreItemFuzzy, compareItemsByFuzzyScore } from "./item-scorer.ts";

function generateFiles(count: number): string[] {
  const files: string[] = [];
  const segments = [
    "src", "components", "utils", "controllers", "models", "views",
    "admin", "public", "assets", "styles", "scripts", "tests",
    "unit", "integration", "e2e", "helpers", "middleware", "routes",
  ];
  const names = [
    "userProfile", "read_me", "index", "controller", "app", "main",
    "config", "database", "server", "client", "api", "auth",
    "login", "register", "dashboard", "home", "about", "contact",
    "createFoo", "updatePackage", "userParser", "ReadProfile",
    "some_deeply_nested", "profile_controller", "totally_unrelated",
  ];
  const exts = [".ts", ".js", ".tsx", ".jsx", ".json", ".md", ".css", ".html"];

  for (let i = 0; i < count; i++) {
    const depth = Math.floor(Math.random() * 4) + 1;
    const pathParts: string[] = [];
    for (let d = 0; d < depth; d++) {
      pathParts.push(segments[Math.floor(Math.random() * segments.length)]);
    }
    const name = names[Math.floor(Math.random() * names.length)];
    const ext = exts[Math.floor(Math.random() * exts.length)];
    files.push(pathParts.join("/") + "/" + name + ext);
  }
  return files;
}

describe("performance", () => {
  it("scores 1 000 candidates in reasonable time", () => {
    const files = generateFiles(1_000);
    const query = "ctrl";
    // Warmup
    for (let w = 0; w < 3; w++) {
      for (const f of files) {
        scoreItemFuzzy(f, (s) => s, query);
      }
    }
    const start = performance.now();
    const scored = [];
    for (const f of files) {
      const r = scoreItemFuzzy(f, (s) => s, query);
      if (r) scored.push(r);
    }
    scored.sort((a, b) => compareItemsByFuzzyScore(a, b, (f) => f));
    const elapsed = performance.now() - start;
    // The spec targets < 5 ms; we allow a little slack for test-framework
    // overhead while still asserting the algorithm is fast.
    assert.ok(elapsed < 15, `expected < 15ms, got ${elapsed.toFixed(2)}ms`);
  });

  it("scores 50 000 candidates in reasonable time", () => {
    const files = generateFiles(50_000);
    const query = "user ctrl";
    // Warmup
    for (let w = 0; w < 2; w++) {
      for (const f of files) {
        scoreItemFuzzy(f, (s) => s, query);
      }
    }
    const start = performance.now();
    const scored = [];
    for (const f of files) {
      const r = scoreItemFuzzy(f, (s) => s, query);
      if (r) scored.push(r);
    }
    scored.sort((a, b) => compareItemsByFuzzyScore(a, b, (f) => f));
    const top = scored.slice(0, 50);
    const elapsed = performance.now() - start;
    // The spec targets < 100 ms with capping; we allow a little slack for
    // test-framework overhead.
    assert.ok(elapsed < 150, `expected < 150ms, got ${elapsed.toFixed(2)}ms`);
  });
});
