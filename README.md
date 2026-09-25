# Fuzzy Autocomplete — Pi Extension

A [Pi](https://github.com/earendil-works/pi) extension that replaces the built-in `@` file-autocomplete with a VS Code Quick Open–style fuzzy scorer.

> 💻 **Vibe coded** with the [`moonshotai/kimi-k2.6`](https://huggingface.co/moonshotai/kimi-k2.6) model. Every line of TypeScript was written, tested, and refined through collaborative prompting — no manual coding required.

## Install

### From git (recommended)

Install permanently from this repository:

```bash
pi install git:github.com/maasha/fuzzy-autocomplete
```

Or try it once without installing:

```bash
pi -e git:github.com/maasha/fuzzy-autocomplete
```

### From a local path

Clone the repo and load the extension directly:

```bash
git clone https://github.com/maasha/fuzzy-autocomplete.git
pi --extension ./fuzzy-autocomplete
```

Or add it to your project's Pi settings:

```json
{
  "packages": [
    {
      "source": "./fuzzy-autocomplete"
    }
  ]
}
```

No build step is required — Pi compiles TypeScript on the fly with `jiti`.

## What it does

When you type `@` followed by a query in Pi's input box, this extension searches all files in the current project and ranks them using a VS Code–style fuzzy match algorithm. Results are highlighted in bold so you can see *why* each file matched.

| Query | Matches | Why it matches |
|-------|---------|----------------|
| `@reme` | `README.md` | `R…E…M…E` (non-contiguous subsequence) |
| `@usrctrl` | `src/user/controller.ts` | `usr` matches `user`, `ctrl` matches `controller` |
| `@src "controller.ts"` | `src/user/controller.ts` | Exact token `"controller.ts"` + fuzzy `src` |
| `@tset` | `tokenizer.test.ts` | `t…s…e…t` matches across words and case boundaries |

## Examples

### Example 1: Typo-tolerant file search

You have this project layout:

```
├── README.md
├── package.json
├── src/
│   ├── tokenizer.ts
│   ├── fuzzy-score.ts
│   └── index.ts
└── tests/
    ├── tokenizer.test.ts
    └── fuzzy-score.test.ts
```

You type `@` and want the tokenizer test file but your fingers slip:

```
@toknizertest
```

**Result:** `tests/tokenizer.test.ts` appears because the fuzzy scorer tolerates the missing `e` and still finds a high-scoring subsequence match.

---

### Example 2: Navigating deeply nested code

Project layout:

```
├── src/
│   ├── user/
│   │   └── controller.ts
│   ├── admin/
│   │   └── controller.ts
│   └── shared/
│       └── utils.ts
```

You type:

```
@usrctrl
```

**Result:** `src/user/controller.ts` ranks highest because:
- `usr` matches the start of `user` (word boundary bonus)
- `ctrl` matches the start of `controller` (word boundary bonus)
- The match is shallower than `src/admin/controller.ts` if that existed

---

### Example 3: Filtering by exact filename across directories

Project layout:

```
├── api/
│   └── controller.ts
├── web/
│   └── controller.ts
└── mobile/
    └── controller.ts
```

You want only the `web` controller:

```
@web "controller.ts"
```

**Result:** `web/controller.ts` is shown; `api/controller.ts` and `mobile/controller.ts` are excluded because the exact token `"controller.ts"` only matches if both tokens match — and `web` doesn't appear in the other paths.

---

### Example 4: Consecutive-character priority

Query:

```
@fuzzy
```

Given two files:
- `fuzzy-score.ts`
- `file-for-you-to-see.ts`

**Result:** `fuzzy-score.ts` wins because the characters `f-u-z-z-y` appear consecutively, earning a much higher score than the scattered match in `file-for-you-to-see.ts`.

---

### Example 5: CamelCase boundary matching

Project layout:

```
├── src/
│   ├── fileDialog.ts
│   └── filedialog.test.ts
```

Query:

```
@fD
```

**Result:** `src/fileDialog.ts` ranks above `src/filedialog.test.ts` because matching the lowercase-to-uppercase transition (`f` → `D`) earns a CamelCase boundary bonus.

---

### Example 6: Multi-token narrowing

Project layout:

```
├── src/
│   ├── components/
│   │   ├── Button.tsx
│   │   └── Modal.tsx
│   └── pages/
│       ├── Home.tsx
│       └── About.tsx
```

Query:

```
@comp btn
```

**Result:** `src/components/Button.tsx` is shown because:
- `comp` matches `components`
- `btn` matches `Button`
- `src/pages/Home.tsx` is excluded because neither token matches

---

## Features

### VS Code–Style Fuzzy Scoring

The scoring algorithm is ported from VS Code's `filters.ts` and assigns bonuses for:

- **Word boundaries** — matches at the start of CamelCase words or after separators (`/`, `-`, `_`, `.`)
- **Consecutive characters** — runs of matched characters score higher than scattered ones
- **Case transitions** — matching lowercase-to-uppercase boundaries (e.g., `d` → `D` in `fileDialog`)
- **Prefix and exact matches** — starting a match at position 0 or matching the entire filename
- **Path depth** — shallower files rank above deeply nested ones when scores are tied

### Multi-Token Queries (AND Semantics)

Separate tokens with spaces. Every token must match for a file to appear.

```
@user ctrl
```

This finds files that match `user` **and** `ctrl` independently — perfect for narrowing results by directory and filename.

### Quoted Exact Tokens

Wrap a token in quotes to require an exact (case-sensitive) substring match instead of fuzzy matching:

```
@src "controller.ts"
```

Here `src` is matched fuzzily anywhere in the path, but `controller.ts` must appear exactly as written.

### Path-Aware Matching

If a token contains `/` or `\`, the scorer gives extra weight to directory-segment matches, so `@src/con` strongly prefers `src/controller.ts` over files that merely contain `s`, `r`, `c`, `c`, `o`, `n` somewhere in their name.

### Performance Capping

- File list is cached for 30 seconds per session
- Results are culled during scoring to keep latency low in large repositories
- Gracefully falls back to Pi's built-in provider when `fd`/`find` is unavailable or no candidates match

## Architecture

| File | Role |
|------|------|
| `index.ts` | Extension entry point. Registers the `AutocompleteProvider` wrapper, handles file discovery (`fd` → `fdfind` → `find`), and formats suggestions with bold highlights |
| `fuzzy-score.ts` | Core scoring algorithm — computes fuzzy match scores and positions |
| `item-scorer.ts` | Orchestrates multi-token scoring, path-aware logic, and final ranking (score → depth → length → lexicographic) |
| `tokenizer.ts` | Splits user input into fuzzy and exact query tokens |
| `*.test.ts` | Unit tests for each module |

## Development

Run tests with [tsx](https://github.com/privatenumber/tsx):

```bash
npx tsx --test fuzzy-score.test.ts
npx tsx --test item-scorer.test.ts
npx tsx --test index.test.ts
npx tsx --test perf.test.ts
```

## License

MIT
