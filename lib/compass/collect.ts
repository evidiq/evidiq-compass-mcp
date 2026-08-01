import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface MarketplaceService {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceDescription: string | null;
  serviceType: string | null;
  feeAmount: number | null;
  feeToken: string | null;
  endpoint: string | null;
  contractAddress: string | null;
}

export interface MarketplaceAgent {
  agentId: string;
  name: string;
  categoryCode: string[] | null;
  categoryName: string[] | null;
  serviceMinPrice: number | null;
  soldCount: number | null;
  buyerCount: number | null;
  feedbackRate: number | null;
  securityRate: number | null;
  onlineStatus: number | null;
  totalServiceCount: number | null;
  communicationAddress: string | null;
  chainIndex: number | null;
  lowestFeeContractAddress: string | null;
  services: MarketplaceService[];
}

export interface AgentSearchResponse {
  total: number | null;
  list: MarketplaceAgent[];
}

export type AgentSearchCall = (
  query: string,
  page: number,
  pageSize: number,
) => Promise<AgentSearchResponse>;

export interface SweepQueryResult {
  query: string;
  pagesFetched: number;
  total: number | null;
  stored: number;
  coverage: number | null;
  truncated: boolean;
  error: string | null;
}

export interface Snapshot {
  schema: 1;
  sweepId: string;
  startedAt: string;
  finishedAt: string;
  source: "onchainos-agent-search";
  basis: "listed_price";
  queries: SweepQueryResult[];
  agents: MarketplaceAgent[];
}

export interface SweepOptions {
  delayMs?: number;
  maxPages?: number;
  maxCalls?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  now?: () => Date;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function coverageOf(stored: number, total: number | null): number | null {
  if (total === null || total === undefined) return null;
  if (total <= 0) return null;
  return Math.min(1, stored / total);
}

interface QueryRun extends SweepQueryResult {
  rows: MarketplaceAgent[];
}

function stripRun(run: QueryRun): SweepQueryResult {
  return {
    query: run.query,
    pagesFetched: run.pagesFetched,
    total: run.total,
    stored: run.stored,
    coverage: run.coverage,
    truncated: run.truncated,
    error: run.error,
  };
}

export async function sweepQuery(
  call: AgentSearchCall,
  query: string,
  pageSize: number,
  opts: Required<Pick<SweepOptions, "maxPages" | "maxRetries" | "retryBaseMs">> & SweepOptions,
): Promise<QueryRun> {
  const seen = new Set<string>();
  const rows: MarketplaceAgent[] = [];
  let total: number | null = null;
  let lastError: string | null = null;
  let pagesFetched = 0;

  for (let page = 1; page <= opts.maxPages; page++) {
    let response: AgentSearchResponse | null = null;
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        response = await call(query, page, pageSize);
        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < opts.maxRetries) {
          await sleep(opts.retryBaseMs * Math.pow(2, attempt));
        }
      }
    }
    if (response === null) {
      break;
    }
    pagesFetched++;
    if (total === null || total === undefined) {
      total = response.total;
    }
    for (const agent of response.list) {
      if (!seen.has(agent.agentId)) {
        seen.add(agent.agentId);
        rows.push(agent);
      }
    }
    if (response.list.length === 0) {
      break;
    }
    if (total !== null && rows.length >= total) {
      break;
    }
    if (opts.delayMs) {
      await sleep(opts.delayMs);
    }
  }

  const stored = rows.length;
  const coverage = coverageOf(stored, total);
  const truncated =
    lastError !== null ||
    total === null ||
    (total > 0 && stored === 0) ||
    stored < (total ?? Number.POSITIVE_INFINITY);

  return {
    query,
    pagesFetched,
    total,
    stored,
    coverage,
    truncated,
    error: lastError,
    rows,
  };
}

export async function runSweep(
  call: AgentSearchCall,
  queries: string[],
  pageSize: number,
  opts: SweepOptions = {},
): Promise<Snapshot> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const delayMs = opts.delayMs ?? 0;
  const maxPages = opts.maxPages ?? 20;
  const maxRetries = opts.maxRetries ?? 2;
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  const maxCalls = opts.maxCalls ?? 500;

  const sweepId = randomUUID();
  const queriesOut: SweepQueryResult[] = [];
  const agents: MarketplaceAgent[] = [];
  const seen = new Set<string>();
  let calls = 0;

  for (const query of queries) {
    if (calls >= maxCalls) {
      queriesOut.push({
        query,
        pagesFetched: 0,
        total: null,
        stored: 0,
        coverage: null,
        truncated: true,
        error: "skipped: sweep cap reached",
      });
      continue;
    }
    const remainingPages = Math.max(1, maxCalls - calls);
    const pageCap = Math.min(maxPages, remainingPages);
    const run = await sweepQuery(call, query, pageSize, {
      delayMs,
      maxPages: pageCap,
      maxRetries,
      retryBaseMs,
    });
    calls += run.pagesFetched;
    queriesOut.push(stripRun(run));
    for (const agent of run.rows) {
      if (!seen.has(agent.agentId)) {
        seen.add(agent.agentId);
        agents.push(agent);
      }
    }
  }

  return {
    schema: 1,
    sweepId,
    startedAt,
    finishedAt: now().toISOString(),
    source: "onchainos-agent-search",
    basis: "listed_price",
    queries: queriesOut,
    agents,
  };
}

export async function writeSnapshot(dir: string, snapshot: Snapshot): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${snapshot.sweepId}.json`);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot));
  await rename(tmp, path);
  return path;
}

export function snapshotFilename(snapshot: Snapshot): string {
  return `${snapshot.sweepId}.json`;
}
