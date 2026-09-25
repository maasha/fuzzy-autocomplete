# Pi VS Code–Style Fuzzy Autocomplete Extension

Replaces Pi's built-in `@` file-autocomplete matching with a VS Code Quick Open–style fuzzy scorer.

## Usage

```bash
pi --extension ./fuzzy-autocomplete
```

## Features

- **Non-contiguous subsequence matching**: `@reme` matches `read_me.txt` via `r…e…m…e`.
- **Smart ranking**: boundary bonuses, CamelCase bonuses, consecutive-match bonuses, prefix/exact bonuses, and case-sensitive alignment bonuses.
- **Multi-token queries**: `@user ctrl` requires both tokens to match (AND semantics).
- **Quoted exact tokens**: `@src "controller.ts"` treats `"controller.ts"` as an exact substring requirement.
- **Graceful fallback**: delegates to the built-in provider when `fd`/`find` is unavailable or when no candidates match.

## Files

- `index.ts` — Pi extension entry point. Registers the `AutocompleteProvider` wrapper.
- `fuzzy-score.ts` — Core scoring algorithm ported from VS Code's `filters.ts`.
- `*.test.ts` — Unit tests.
