import { describe, expect, it } from "vitest";
import { createAggregator, detectColumns, lookupPrice } from "./engine";

describe("detectColumns", () => {
  it("maps OpenAI-style and Anthropic-style headers", () => {
    expect(detectColumns(["model", "prompt_tokens", "completion_tokens"])).toEqual({
      model: "model",
      input: "prompt_tokens",
      output: "completion_tokens",
    });
    const a = detectColumns(["Model", "input_tokens", "output_tokens", "cache_read_input_tokens"]);
    expect(a.cached).toBe("cache_read_input_tokens");
  });

  it("leaves unknown fields undefined", () => {
    expect(detectColumns(["foo", "bar"]).model).toBeUndefined();
  });
});

describe("lookupPrice", () => {
  it("prefers the longest matching key", () => {
    expect(lookupPrice("gpt-4o-mini-2024")?.input).toBe(0.15);
    expect(lookupPrice("gpt-4o")?.input).toBe(2.5);
  });
});

describe("createAggregator", () => {
  const cols = { model: "m", input: "i", output: "o", cached: "c" };
  const prices = { x: { input: 1, cachedInput: 0.1, output: 2 } };
  const row = { m: "x", i: "1000000", o: "1000000", c: "400000" };

  it("does not bill cached tokens twice (OpenAI-style: cached is inside input)", () => {
    const a = createAggregator(cols, "openai", prices);
    a.add(row);
    // fresh input 600k * $1 + cached 400k * $0.1 + output 1M * $2 = 0.6 + 0.04 + 2 = 2.64
    expect(a.result().totalCostUsd).toBeCloseTo(2.64, 6);
  });

  it("bills cached separately (Anthropic-style)", () => {
    const a = createAggregator(cols, "anthropic", prices);
    a.add(row);
    // input 1M * $1 + cached 400k * $0.1 + output 1M * $2 = 1 + 0.04 + 2 = 3.04
    expect(a.result().totalCostUsd).toBeCloseTo(3.04, 6);
  });

  it("skips rows with bad numbers and flags unpriced models", () => {
    const a = createAggregator(cols, "openai", prices);
    a.add({ m: "x", i: "abc", o: "1", c: "0" });
    a.add({ m: "nope", i: "10", o: "10", c: "0" });
    const r = a.result();
    expect(r.skippedRows).toBe(1);
    expect(r.unpricedModels).toEqual(["nope"]);
  });
});
