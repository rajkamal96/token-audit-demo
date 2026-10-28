import { useEffect, useRef, useState } from "react";
import type { AuditResult, CachedConvention, ColumnMap } from "./engine";
import type { WorkerMessage } from "./worker";
import { generateSampleCsv } from "./sampleFile";

const fmt = new Intl.NumberFormat("en-US");
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Badge({ kind }: { kind: "measured" | "estimated" }) {
  return <span className={`badge ${kind}`}>{kind}</span>;
}

// Ticks every 50 ms and records the longest gap between ticks. If parsing blocked the
// main thread this number would jump into the seconds; with the worker it stays small.
function Heartbeat() {
  const [ticks, setTicks] = useState(0);
  const [maxGap, setMaxGap] = useState(0);
  useEffect(() => {
    let last = performance.now();
    let max = 0;
    const id = setInterval(() => {
      const now = performance.now();
      max = Math.max(max, now - last);
      last = now;
      setTicks((t) => t + 1);
      setMaxGap(Math.round(max));
    }, 50);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="heartbeat" title="Longest gap between 50 ms UI timer ticks">
      UI ticks: {ticks} · longest stall: {maxGap} ms
    </span>
  );
}

export default function App() {
  const workerRef = useRef<Worker | null>(null);
  const [convention, setConvention] = useState<CachedConvention>("openai");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [fraction, setFraction] = useState(0);
  const [rowsSeen, setRowsSeen] = useState(0);
  const [columns, setColumns] = useState<ColumnMap | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [ms, setMs] = useState(0);
  const [fileInfo, setFileInfo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => workerRef.current?.terminate(), []);

  function run(file: File) {
    workerRef.current?.terminate();
    setResult(null);
    setColumns(null);
    setError("");
    setFraction(0);
    setRowsSeen(0);
    setBusy(true);
    setStatus("Parsing in a Web Worker…");
    setFileInfo(`${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === "progress") {
        setFraction(m.fraction);
        setRowsSeen(m.rows);
      } else if (m.type === "columns") {
        setColumns(m.columns);
      } else if (m.type === "done") {
        setResult(m.result);
        setMs(m.ms);
        setFraction(1);
        setBusy(false);
        setStatus("Done");
        worker.terminate();
      } else {
        setError(m.message);
        setBusy(false);
        setStatus("");
      }
    };
    worker.postMessage({ file, convention });
  }

  async function runSample(rows: number) {
    setError("");
    setResult(null);
    setBusy(true);
    setStatus("Generating test file in the browser…");
    const file = await generateSampleCsv(rows, setFraction);
    run(file);
  }

  function cancel() {
    workerRef.current?.terminate();
    setBusy(false);
    setStatus("Cancelled");
  }

  return (
    <main>
      <h1>Token Audit Demo</h1>
      <p className="sub">
        Drop an LLM usage CSV. Parsing runs in a Web Worker, streams the file in chunks and keeps
        only running totals, so large files do not freeze the page. Nothing is uploaded: the file
        never leaves your browser.
      </p>

      <section className="card">
        <div className="row">
          <label className="drop">
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => e.target.files?.[0] && run(e.target.files[0])}
            />
            Choose a CSV file
          </label>
          <label>
            Cached-token convention{" "}
            <select
              value={convention}
              disabled={busy}
              onChange={(e) => setConvention(e.target.value as CachedConvention)}
            >
              <option value="openai">OpenAI-style (cached is part of input)</option>
              <option value="anthropic">Anthropic-style (cached is separate)</option>
            </select>
          </label>
        </div>
        <div className="row">
          <span>Or generate a test file:</span>
          {[100_000, 1_000_000, 3_000_000].map((n) => (
            <button key={n} disabled={busy} onClick={() => runSample(n)}>
              {fmt.format(n)} rows
            </button>
          ))}
          {busy && <button onClick={cancel}>Cancel</button>}
          <Heartbeat />
        </div>
        {(busy || status) && (
          <div className="progress" aria-live="polite">
            <progress value={fraction} max={1} />
            <span>
              {status} {fileInfo && `· ${fileInfo}`} {rowsSeen > 0 && `· ${fmt.format(rowsSeen)} rows`}
            </span>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {columns && (
        <section className="card">
          <h2>Detected columns</h2>
          <ul className="cols">
            {(["model", "input", "output", "cached", "reasoning"] as const).map((f) => (
              <li key={f}>
                <b>{f}</b>: {columns[f] ?? <em className="warn">not found (treated as 0)</em>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result && (
        <section className="card">
          <h2>Audit result</h2>
          <p>
            {fmt.format(result.rows)} rows parsed in {(ms / 1000).toFixed(2)} s
            {result.skippedRows > 0 && `, ${fmt.format(result.skippedRows)} skipped (bad numbers)`}.
          </p>
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Rows</th>
                <th>Input <Badge kind="measured" /></th>
                <th>Cached <Badge kind="measured" /></th>
                <th>Output <Badge kind="measured" /></th>
                <th>Reasoning <Badge kind="measured" /></th>
                <th>Cost <Badge kind="estimated" /></th>
              </tr>
            </thead>
            <tbody>
              {result.models.map((m) => (
                <tr key={m.model}>
                  <td>{m.model}</td>
                  <td>{fmt.format(m.rows)}</td>
                  <td>{fmt.format(m.input)}</td>
                  <td>{fmt.format(m.cached)}</td>
                  <td>{fmt.format(m.output)}</td>
                  <td>{fmt.format(m.reasoning)}</td>
                  <td>{m.costUsd === null ? <em className="warn">no price</em> : usd(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Total (priced models only)</td>
                <td>{usd(result.totalCostUsd)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="note">
            Token counts are <b>measured</b> (taken as reported in the file). Costs are{" "}
            <b>estimated</b> using illustrative placeholder prices, not live prices. Reasoning tokens
            are shown for information; providers bill them as output tokens, so they are already inside
            the output count.
          </p>
        </section>
      )}
    </main>
  );
}
