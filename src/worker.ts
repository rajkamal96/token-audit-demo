import Papa from "papaparse";
import { createAggregator, detectColumns, type CachedConvention, type ColumnMap } from "./engine";

export interface WorkerRequest {
  file: File;
  convention: CachedConvention;
}

export type WorkerMessage =
  | { type: "progress"; fraction: number; rows: number }
  | { type: "columns"; columns: ColumnMap; headers: string[] }
  | { type: "done"; result: ReturnType<ReturnType<typeof createAggregator>["result"]>; ms: number }
  | { type: "error"; message: string };

const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { file, convention } = e.data;
  const started = performance.now();
  let agg: ReturnType<typeof createAggregator> | null = null;
  let columns: ColumnMap = {};
  let rows = 0;
  let lastPost = 0;

  // Streaming parse: only one chunk is in memory at a time, and only running
  // totals per model are kept, never the full list of rows.
  Papa.parse<Record<string, unknown>>(file, {
    header: true,
    skipEmptyLines: true,
    chunkSize: 1024 * 1024 * 4,
    chunk: (results) => {
      if (!agg) {
        const headers = results.meta.fields ?? [];
        columns = detectColumns(headers);
        post({ type: "columns", columns, headers });
        agg = createAggregator(columns, convention);
      }
      for (const rec of results.data) {
        agg.add(rec);
        rows++;
      }
      const now = performance.now();
      if (now - lastPost > 100) {
        lastPost = now;
        post({ type: "progress", fraction: Math.min(results.meta.cursor / file.size, 1), rows });
      }
    },
    complete: () => {
      if (!agg) {
        post({ type: "error", message: "The file has no rows." });
        return;
      }
      post({ type: "done", result: agg.result(), ms: performance.now() - started });
    },
    error: (err) => post({ type: "error", message: err.message }),
  });
};
