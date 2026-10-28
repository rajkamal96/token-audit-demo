# Token Audit Demo

A small browser-only demo of auditing LLM usage logs: drop a CSV, see tokens and estimated cost per model.
It exists to show one thing well: **parsing a large user-supplied file in the browser without freezing the page, and without the data ever leaving the machine.**

## Try it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the calculation engine
npm run build      # typecheck + production build
```

No file handy? Use one of the **Generate a test file** buttons (100k / 1M / 3M rows). 3M rows is ~139 MB.
To make a file on disk instead: `npm run sample -- 3000000` (writes `sample-usage.csv`).

## How it handles big files

- **Web Worker.** `src/worker.ts` does all parsing, so the main thread stays free. The UI shows a timer-based
  "longest stall" meter so you can see this for yourself.
- **Streaming.** Papa Parse reads the `File` in 4 MB chunks. Only one chunk is in memory at a time, and only
  **running totals per model** are kept, never the full list of rows. Memory stays flat as the file grows.
- **Progress and cancel.** The worker posts throttled progress (every ~100 ms); Cancel terminates the worker.
- **Local only.** There is no network call. The `File` object is read directly in the worker.

Measured in a browser: 3,000,000 rows (139 MB) parsed in about 7 seconds with live progress, and the UI
timer kept ticking every ~50 ms throughout parsing.

## Structure

| File | Role |
| --- | --- |
| `src/engine.ts` | Pure calculation engine: column detection, cached-token conventions, pricing lookup, aggregation. No DOM or React, so it runs in the worker and in tests. |
| `src/worker.ts` | Streaming CSV parse and aggregation off the main thread. |
| `src/App.tsx` | UI: file picker, convention switch, progress, detected columns, result table. |
| `src/engine.test.ts` | Vitest tests for the engine. |

## Token billing notes (and why there is a convention switch)

- **Input** tokens: the prompt, billed at the input rate. **Output** tokens: the generated reply, billed at the output rate.
- **Cached input** tokens: the part of the prompt served from a prompt cache, billed at a discounted rate.
  OpenAI-style logs report cached tokens as a **subset of** `prompt_tokens`. Anthropic-style logs report cache
  reads **separately** from `input_tokens`. The convention switch normalises both so cached tokens are never
  billed twice (see the tests).
- **Reasoning** tokens: hidden thinking tokens. They are billed as output tokens and are already inside the output
  count, so the demo shows them for information only and does not add them again.

Check these against each provider's current docs before relying on them: field names and prices change.

## Labels

Every figure is tagged **measured** (taken as reported in the file) or **estimated** (computed by the tool).

## Limitations (this is a demo, not the full tool)

- **Prices are illustrative placeholders** in `SAMPLE_PRICES`, not live. A production version would load the public
  LiteLLM pricing registry, version it and record the version used for each row.
- Only CSV, with automatic column detection. No JSON / OpenTelemetry import and no manual column-mapping UI yet.
- No per-row audit trail, no CSV/JSON/PDF export, no analytics.
- Test-file generation builds the file on the main thread in chunks, which causes a short stall (about 0.7 s for
  139 MB) before parsing starts. Parsing itself does not stall the page.

## Deploy

It is a static site (`vite build` writes `dist/`, with relative asset paths), so it works on Vercel, Netlify or GitHub Pages.
