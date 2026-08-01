import { spawnSync } from "node:child_process";
import { AgentSearchCall, AgentSearchResponse, MarketplaceAgent, runSweep, writeSnapshot } from "./collect.js";

export const SEED_QUERIES = [
  "security",
  "trading",
  "data",
  "api",
  "agent",
  "market",
  "payment",
  "analytics",
  "research",
  "intelligence",
  "compliance",
  "defi",
  "nft",
  "privacy",
  "prediction",
  "news",
  "social",
  "swap",
  "wallet",
  "risk",
];

export interface CollectorOptions {
  dataDir: string;
  cliPath: string;
  queries: string[];
  pageSize: number;
  delayMs: number;
  maxPages: number;
  maxCalls: number;
}

function parseArgs(argv: string[]): CollectorOptions {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const queriesRaw = get("--queries", "");
  return {
    dataDir: get("--data-dir", "./data"),
    cliPath: get("--cli", "/root/.local/bin/onchainos"),
    queries: queriesRaw ? queriesRaw.split(",").map((q) => q.trim()).filter(Boolean) : SEED_QUERIES,
    pageSize: Number(get("--page-size", "100")),
    delayMs: Number(get("--delay-ms", "250")),
    maxPages: Number(get("--max-pages", "20")),
    maxCalls: Number(get("--max-calls", "200")),
  };
}

export { parseArgs };

export function makeCliCall(cliPath: string): AgentSearchCall {
  return (query: string, page: number, pageSize: number) => {
    const result = spawnSync(
      cliPath,
      ["agent", "search", "--query", query, "--page", String(page), "--page-size", String(pageSize)],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120_000 },
    );
    if (result.status !== 0) {
      const detail = (result.stderr ?? "").trim() || (result.stdout ?? "").trim().slice(0, 300);
      throw new Error(`onchainos exit ${result.status}: ${detail}`);
    }
    let parsed: { ok: boolean; data?: { list?: MarketplaceAgent[]; total?: number | null } };
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(`onchainos returned unparseable output: ${result.stdout.slice(0, 300)}`);
    }
    if (!parsed.ok || !parsed.data) {
      throw new Error(`onchainos failed: ${result.stdout.slice(0, 300)}`);
    }
    const response: AgentSearchResponse = {
      total: parsed.data.total ?? null,
      list: parsed.data.list ?? [],
    };
    return Promise.resolve(response);
  };
}

export async function runCollector(opts: CollectorOptions) {
  const call = makeCliCall(opts.cliPath);
  const snapshot = await runSweep(call, opts.queries, opts.pageSize, {
    delayMs: opts.delayMs,
    maxPages: opts.maxPages,
    maxCalls: opts.maxCalls,
    maxRetries: 2,
    retryBaseMs: 2000,
  });
  const path = await writeSnapshot(opts.dataDir, snapshot);
  const nServices = snapshot.agents.reduce((n, a) => n + (a.services?.length ?? 0), 0);
  const coverage = snapshot.queries.filter((q) => q.coverage !== null).map((q) => q.coverage as number);
  const summary = {
    sweepId: snapshot.sweepId,
    snapshotFile: path,
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    queries: snapshot.queries.length,
    agents: snapshot.agents.length,
    services: nServices,
    minCoverage: coverage.length ? Math.min(...coverage) : null,
    perQuery: snapshot.queries.map((q) => ({
      query: q.query,
      total: q.total,
      stored: q.stored,
      coverage: q.coverage,
      truncated: q.truncated,
      error: q.error,
    })),
  };
  return summary;
}
