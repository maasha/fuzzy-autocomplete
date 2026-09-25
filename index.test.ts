import { describe, it } from "node:test";
import assert from "node:assert";
import { extractAtPrefix, createFuzzyAutocompleteProvider } from "./index.ts";

describe("extension provider logic", () => {
  it("extracts @-prefix correctly", () => {
    assert.strictEqual(extractAtPrefix("@reme"), "reme");
    assert.strictEqual(extractAtPrefix("foo @src ctrl"), "src ctrl");
    assert.strictEqual(extractAtPrefix("foo bar"), undefined);
    assert.strictEqual(extractAtPrefix("@"), "");
    assert.strictEqual(extractAtPrefix("  @user"), "user");
  });

  it("delegates non-@ tokens to underlying provider", async () => {
    let delegated = false;
    const current = {
      async getSuggestions() {
        delegated = true;
        return { items: [{ value: "test", label: "test" }], prefix: "" };
      },
      applyCompletion() {
        return { lines: [], cursorLine: 0, cursorCol: 0 };
      },
      shouldTriggerFileCompletion() {
        return true;
      },
    };

    const mockPi = {
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    } as any;

    const provider = createFuzzyAutocompleteProvider(current, mockPi, "/tmp");
    const result = await provider.getSuggestions(["/reload"], 0, 7, {
      signal: new AbortController().signal,
    });
    assert.ok(delegated);
    assert.ok(result);
  });

  it("falls back to built-in provider when file discovery fails", async () => {
    let delegated = false;
    const current = {
      async getSuggestions() {
        delegated = true;
        return { items: [{ value: "fallback", label: "fallback" }], prefix: "" };
      },
      applyCompletion() {
        return { lines: [], cursorLine: 0, cursorCol: 0 };
      },
      shouldTriggerFileCompletion() {
        return true;
      },
    };

    const mockPi = {
      exec: async () => {
        throw new Error("no fd");
      },
    } as any;

    const provider = createFuzzyAutocompleteProvider(current, mockPi, "/tmp");
    const result = await provider.getSuggestions(["@foo"], 0, 4, {
      signal: new AbortController().signal,
    });
    assert.ok(delegated);
    assert.ok(result);
  });
});
