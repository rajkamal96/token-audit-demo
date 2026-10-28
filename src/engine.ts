// Pure calculation engine: no DOM, no React, so it runs in a Web Worker and in Vitest.

export type Field = "model" | "input" | "output" | "cached" | "reasoning";

// How the provider reports cached tokens.
//  - "openai":    cached tokens are a SUBSET of input tokens (prompt_tokens includes them)
//  - "anthropic": cached reads are reported SEPARATELY from input tokens
export type CachedConvention = "openai" | "anthropic";

export type ColumnMap = Partial<Record<Field, string>>;

const ALIASES: Record<Field, string[]> = {
  model: ["model", "model_name", "model_id", "gen_ai.request.model", "gen_ai.response.model"],
  input: [
    "input_tokens", "prompt_tokens", "tokens_in", "input",
    "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens",
  ],
  output: [
    "output_tokens", "completion_tokens", "tokens_out", "output",
    "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens",
  ],
  cached: [
    "cached_tokens", "cache_read_input_tokens", "cached_input_tokens", "cache_read_tokens",
    "prompt_tokens_details.cached_tokens",
  ],
  reasoning: [
    "reasoning_tokens", "completion_tokens_details.reasoning_tokens", "thinking_tokens",
  ],
};

const norm = (s: string) => s.trim().toLowerCase();

/** Match CSV headers to the fields we need. Unmatched fields are left undefined. */
export function detectColumns(headers: string[]): ColumnMap {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const map: ColumnMap = {};
  (Object.keys(ALIASES) as Field[]).forEach((field) => {
    for (const alias of ALIASES[field]) {
      const hit = byNorm.get(alias);
      if (hit !== undefined) {
        map[field] = hit;
        break;
      }
    }
  });
  return map;
}

export interface Price {
  input: number; // USD per 1M tokens
  cachedInput: number;
  output: number;
}

// ILLUSTRATIVE placeholder prices only. A production tool would load these from the
// public LiteLLM pricing registry and record the version used for every row.
export const SAMPLE_PRICES: Record<string, Price> = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "claude-sonnet": { input: 3, cachedInput: 0.3, output: 15 },
  "claude-haiku": { input: 0.8, cachedInput: 0.08, output: 4 },
};

export function lookupPrice(model: string, prices = SAMPLE_PRICES): Price | undefined {
  const m = norm(model);
  // Longest key first so "gpt-4o-mini" wins over "gpt-4o".
  const keys = Object.keys(prices).sort((a, b) => b.length - a.length);
  const key = keys.find((k) => m.includes(k));
  return key ? prices[key] : undefined;
}

export interface ModelTotals {
  model: string;
  rows: number;
  input: number; // measured (as reported)
  cached: number; // measured
  output: number; // measured
  reasoning: number; // measured, informational (already inside output)
  costUsd: number | null; // estimated; null when the model has no price
}

export interface AuditResult {
  rows: number;
  skippedRows: number;
  models: ModelTotals[];
  totalCostUsd: number; // estimated, priced models only
  unpricedModels: string[];
}

const toInt = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function createAggregator(
  columns: ColumnMap,
  convention: CachedConvention,
  prices: Record<string, Price> = SAMPLE_PRICES,
) {
  const totals = new Map<string, ModelTotals>();
  let rows = 0;
  let skipped = 0;

  return {
    add(record: Record<string, unknown>) {
      const model = String(record[columns.model ?? ""] ?? "").trim() || "(unknown)";
      const input = toInt(record[columns.input ?? ""]);
      const output = toInt(record[columns.output ?? ""]);
      const cached = toInt(record[columns.cached ?? ""]);
      const reasoning = toInt(record[columns.reasoning ?? ""]);
      if (input === null || output === null || cached === null || reasoning === null) {
        skipped++;
        return;
      }
      rows++;
      let t = totals.get(model);
      if (!t) {
        t = { model, rows: 0, input: 0, cached: 0, output: 0, reasoning: 0, costUsd: null };
        totals.set(model, t);
      }
      t.rows++;
      t.input += input;
      t.cached += cached;
      t.output += output;
      t.reasoning += reasoning;
    },

    result(): AuditResult {
      const models = [...totals.values()];
      const unpriced: string[] = [];
      let total = 0;
      for (const t of models) {
        const p = lookupPrice(t.model, prices);
        if (!p) {
          t.costUsd = null;
          unpriced.push(t.model);
          continue;
        }
        // Normalise so cached tokens are never billed twice.
        const freshInput = convention === "openai" ? Math.max(t.input - t.cached, 0) : t.input;
        t.costUsd =
          (freshInput * p.input + t.cached * p.cachedInput + t.output * p.output) / 1_000_000;
        total += t.costUsd;
      }
      models.sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1));
      return { rows, skippedRows: skipped, models, totalCostUsd: total, unpricedModels: unpriced };
    },
  };
}
