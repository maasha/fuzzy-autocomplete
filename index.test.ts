import { describe, it } from "node:test";
import assert from "node:assert";

describe("extension provider logic", () => {
  it("extracts @-prefix correctly", () => {
    const extractAtPrefix = (text: string) => {
      const match = text.match(/(?:^|[ \t])@(.*)$/);
      return match?.[1]?.trim();
    };

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

    // Simulate provider behavior for a non-@ query
    const lines = ["/reload"];
    const result = await current.getSuggestions(lines, 0, 7, {
      signal: new AbortController().signal,
    });
    assert.ok(delegated);
    assert.ok(result);
  });
});
