// Usage: npm run sample -- 3000000   (writes sample-usage.csv, ~200 MB for 3M rows)
import { createWriteStream } from "node:fs";

const rows = Number(process.argv[2] ?? 1_000_000);
const models = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4", "claude-haiku-3-5", "mystery-model"];
const out = createWriteStream("sample-usage.csv");
out.write("timestamp,model,input_tokens,output_tokens,cached_tokens,reasoning_tokens\n");

for (let i = 0; i < rows; i++) {
  const input = 200 + Math.floor(Math.random() * 6000);
  const cached = Math.random() < 0.4 ? Math.floor(input * Math.random() * 0.8) : 0;
  const output = 50 + Math.floor(Math.random() * 1500);
  const reasoning = Math.random() < 0.15 ? Math.floor(output * 0.5) : 0;
  const line = `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z,${models[i % models.length]},${input},${output},${cached},${reasoning}\n`;
  if (!out.write(line)) await new Promise((r) => out.once("drain", r));
}
out.end();
console.log(`wrote sample-usage.csv (${rows} rows)`);
