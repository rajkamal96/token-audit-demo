// Builds a synthetic usage CSV in the browser, in chunks, so the page stays responsive.
const MODELS = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4", "claude-haiku-3-5", "mystery-model"];
const HEADER = "timestamp,model,input_tokens,output_tokens,cached_tokens,reasoning_tokens\n";

export async function generateSampleCsv(
  rows: number,
  onProgress: (fraction: number) => void,
): Promise<File> {
  const parts: string[] = [HEADER];
  const CHUNK = 50_000;
  for (let i = 0; i < rows; i += CHUNK) {
    const n = Math.min(CHUNK, rows - i);
    let s = "";
    for (let j = 0; j < n; j++) {
      const input = 200 + Math.floor(Math.random() * 6000);
      const cached = Math.random() < 0.4 ? Math.floor(input * Math.random() * 0.8) : 0;
      const output = 50 + Math.floor(Math.random() * 1500);
      const reasoning = Math.random() < 0.15 ? Math.floor(output * 0.5) : 0;
      const model = MODELS[(i + j) % MODELS.length];
      s += `2026-10-${String(1 + ((i + j) % 28)).padStart(2, "0")}T12:00:00Z,${model},${input},${output},${cached},${reasoning}\n`;
    }
    parts.push(s);
    onProgress((i + n) / rows);
    await new Promise((r) => setTimeout(r, 0)); // yield to the browser
  }
  return new File(parts, `sample-usage-${rows}.csv`, { type: "text/csv" });
}
