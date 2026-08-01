import Database from "better-sqlite3";
import type { Snapshot } from "./collect.js";

export interface LatestAgentRow {
  agentId: string;
  name: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  serviceMinPrice: number | null;
  soldCount: number | null;
  buyerCount: number | null;
  feedbackRate: number | null;
  securityRate: number | null;
  onlineStatus: number | null;
  totalServiceCount: number | null;
  communicationAddress: string | null;
  chainIndex: number | null;
  services: ServiceRow[];
}

export interface ServiceRow {
  serviceId: string;
  id: string | null;
  name: string | null;
  description: string | null;
  type: string | null;
  feeAmount: number | null;
  feeToken: string | null;
  endpoint: string | null;
}

export interface SnapshotSummary {
  sweepId: string;
  startedAt: string;
  finishedAt: string;
  nAgents: number;
  nServices: number;
  minCoverage: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  sweep_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  source TEXT NOT NULL,
  basis TEXT NOT NULL,
  n_agents INTEGER NOT NULL,
  n_services INTEGER NOT NULL,
  min_coverage REAL,
  imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sweep_queries (
  sweep_id TEXT NOT NULL,
  query TEXT NOT NULL,
  pages_fetched INTEGER NOT NULL,
  total INTEGER,
  stored INTEGER NOT NULL,
  coverage REAL,
  truncated INTEGER NOT NULL,
  error TEXT,
  PRIMARY KEY (sweep_id, query)
);
CREATE TABLE IF NOT EXISTS agents (
  sweep_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  name TEXT,
  category_code TEXT,
  category_name TEXT,
  service_min_price REAL,
  sold_count INTEGER,
  buyer_count INTEGER,
  feedback_rate REAL,
  security_rate REAL,
  online_status INTEGER,
  total_service_count INTEGER,
  communication_address TEXT,
  chain_index INTEGER,
  lowest_fee_contract_address TEXT,
  PRIMARY KEY (sweep_id, agent_id)
);
CREATE TABLE IF NOT EXISTS services (
  sweep_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  id TEXT,
  name TEXT,
  description TEXT,
  type TEXT,
  fee_amount REAL,
  fee_token TEXT,
  endpoint TEXT,
  contract_address TEXT,
  PRIMARY KEY (sweep_id, agent_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_agents_sweep ON agents(sweep_id);
CREATE INDEX IF NOT EXISTS idx_services_sweep ON services(sweep_id, agent_id);
CREATE TABLE IF NOT EXISTS artifacts (
  digest TEXT PRIMARY KEY,
  report TEXT NOT NULL,
  signature TEXT NOT NULL,
  signer TEXT NOT NULL,
  anchor_root TEXT,
  anchor_tx TEXT,
  created_at TEXT NOT NULL
);
`;

export function openStore(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function importSnapshot(db: Database.Database, snap: Snapshot): void {
  const nServices = snap.agents.reduce((n, a) => n + (a.services?.length ?? 0), 0);
  const coverages = snap.queries
    .filter((q) => q.coverage !== null)
    .map((q) => q.coverage as number);
  const minCoverage = coverages.length ? Math.min(...coverages) : null;

  const insertSnapshot = db.prepare(
    `INSERT OR REPLACE INTO snapshots
     (sweep_id, started_at, finished_at, source, basis, n_agents, n_services, min_coverage, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertQuery = db.prepare(
    `INSERT OR REPLACE INTO sweep_queries
     (sweep_id, query, pages_fetched, total, stored, coverage, truncated, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAgent = db.prepare(
    `INSERT OR REPLACE INTO agents
     (sweep_id, agent_id, name, category_code, category_name, service_min_price, sold_count,
      buyer_count, feedback_rate, security_rate, online_status, total_service_count,
      communication_address, chain_index, lowest_fee_contract_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertService = db.prepare(
    `INSERT OR REPLACE INTO services
     (sweep_id, agent_id, service_id, id, name, description, type, fee_amount, fee_token,
      endpoint, contract_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    insertSnapshot.run(
      snap.sweepId,
      snap.startedAt,
      snap.finishedAt,
      snap.source,
      snap.basis,
      snap.agents.length,
      nServices,
      minCoverage,
      new Date().toISOString(),
    );
    for (const q of snap.queries) {
      insertQuery.run(
        snap.sweepId,
        q.query,
        q.pagesFetched,
        q.total,
        q.stored,
        q.coverage,
        q.truncated ? 1 : 0,
        q.error,
      );
    }
    for (const agent of snap.agents) {
      insertAgent.run(
        snap.sweepId,
        agent.agentId,
        agent.name,
        agent.categoryCode?.join(",") ?? null,
        agent.categoryName?.join(",") ?? null,
        agent.serviceMinPrice,
        agent.soldCount,
        agent.buyerCount,
        agent.feedbackRate,
        agent.securityRate,
        agent.onlineStatus,
        agent.totalServiceCount,
        agent.communicationAddress,
        agent.chainIndex,
        agent.lowestFeeContractAddress,
      );
      for (const svc of agent.services ?? []) {
        insertService.run(
          snap.sweepId,
          agent.agentId,
          svc.serviceId ?? svc.id,
          svc.id,
          svc.serviceName,
          svc.serviceDescription,
          svc.serviceType,
          svc.feeAmount,
          svc.feeToken,
          svc.endpoint,
          svc.contractAddress,
        );
      }
    }
  })();
}

export function listSnapshots(db: Database.Database): SnapshotSummary[] {
  const rows = db
    .prepare(
      `SELECT sweep_id, started_at, finished_at, n_agents, n_services, min_coverage
       FROM snapshots ORDER BY started_at DESC`,
    )
    .all() as Array<{
    sweep_id: string;
    started_at: string;
    finished_at: string;
    n_agents: number;
    n_services: number;
    min_coverage: number | null;
  }>;
  return rows.map((r) => ({
    sweepId: r.sweep_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    nAgents: r.n_agents,
    nServices: r.n_services,
    minCoverage: r.min_coverage,
  }));
}

export function latestSnapshot(db: Database.Database): SnapshotSummary | null {
  const list = listSnapshots(db);
  return list[0] ?? null;
}

export interface StoredArtifact {
  digest: string;
  report: unknown;
  signature: string;
  signer: string;
  anchorRoot: string | null;
  anchorTx: string | null;
  createdAt: string;
}

export function saveArtifact(
  db: Database.Database,
  artifact: Omit<StoredArtifact, "createdAt">,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO artifacts
     (digest, report, signature, signer, anchor_root, anchor_tx, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    artifact.digest,
    JSON.stringify(artifact.report),
    artifact.signature,
    artifact.signer,
    artifact.anchorRoot,
    artifact.anchorTx,
    new Date().toISOString(),
  );
}

export function getArtifact(db: Database.Database, digest: string): StoredArtifact | null {
  const row = db.prepare(`SELECT * FROM artifacts WHERE digest = ?`).get(digest) as
    | {
        digest: string;
        report: string;
        signature: string;
        signer: string;
        anchor_root: string | null;
        anchor_tx: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    digest: row.digest,
    report: JSON.parse(row.report),
    signature: row.signature,
    signer: row.signer,
    anchorRoot: row.anchor_root,
    anchorTx: row.anchor_tx,
    createdAt: row.created_at,
  };
}

export interface SweepPricePoint {
  sweepId: string;
  startedAt: string;
  finishedAt: string;
  count: number;
  prices: number[];
}

export function pricesPerSweep(
  db: Database.Database,
  category?: string | null,
): SweepPricePoint[] {
  const cat = category?.toLowerCase();
  const rows = db
    .prepare(
      `SELECT s.sweep_id AS sweep_id, s.started_at AS started_at, s.finished_at AS finished_at,
              a.category_code AS category_code, a.category_name AS category_name,
              svc.fee_amount AS fee_amount
       FROM services svc
       JOIN agents a ON a.sweep_id = svc.sweep_id AND a.agent_id = svc.agent_id
       JOIN snapshots s ON s.sweep_id = svc.sweep_id
       WHERE svc.fee_amount IS NOT NULL
       ORDER BY s.started_at ASC`,
    )
    .all() as Array<{
    sweep_id: string;
    started_at: string;
    finished_at: string;
    category_code: string | null;
    category_name: string | null;
    fee_amount: number | null;
  }>;
  const bySweep = new Map<string, SweepPricePoint>();
  for (const r of rows) {
    const joined = [r.category_code, r.category_name].filter(Boolean).join(" ").toLowerCase();
    if (cat && !joined.includes(cat)) continue;
    const point = bySweep.get(r.sweep_id) ?? {
      sweepId: r.sweep_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      count: 0,
      prices: [],
    };
    if (r.fee_amount !== null && Number.isFinite(r.fee_amount)) {
      point.prices.push(r.fee_amount);
      point.count++;
    }
    bySweep.set(r.sweep_id, point);
  }
  return [...bySweep.values()];
}

export function latestAgents(db: Database.Database): LatestAgentRow[] {
  const latest = latestSnapshot(db);
  if (!latest) return [];
  const agents = db
    .prepare(
      `SELECT agent_id, name, category_code, category_name, service_min_price, sold_count,
              buyer_count, feedback_rate, security_rate, online_status, total_service_count,
              communication_address, chain_index
       FROM agents WHERE sweep_id = ? ORDER BY agent_id`,
    )
    .all(latest.sweepId) as Array<{
    agent_id: string;
    name: string | null;
    category_code: string | null;
    category_name: string | null;
    service_min_price: number | null;
    sold_count: number | null;
    buyer_count: number | null;
    feedback_rate: number | null;
    security_rate: number | null;
    online_status: number | null;
    total_service_count: number | null;
    communication_address: string | null;
    chain_index: number | null;
  }>;
  const services = db
    .prepare(
      `SELECT agent_id, service_id, id, name, description, type, fee_amount, fee_token, endpoint
       FROM services WHERE sweep_id = ? ORDER BY agent_id, service_id`,
    )
    .all(latest.sweepId) as Array<{
    agent_id: string;
    service_id: string;
    id: string | null;
    name: string | null;
    description: string | null;
    type: string | null;
    fee_amount: number | null;
    fee_token: string | null;
    endpoint: string | null;
  }>;

  const byAgent = new Map<string, ServiceRow[]>();
  for (const s of services) {
    const list = byAgent.get(s.agent_id) ?? [];
    list.push({
      serviceId: s.service_id,
      id: s.id,
      name: s.name,
      description: s.description,
      type: s.type,
      feeAmount: s.fee_amount,
      feeToken: s.fee_token,
      endpoint: s.endpoint,
    });
    byAgent.set(s.agent_id, list);
  }

  return agents.map((a) => ({
    agentId: a.agent_id,
    name: a.name,
    categoryCode: a.category_code,
    categoryName: a.category_name,
    serviceMinPrice: a.service_min_price,
    soldCount: a.sold_count,
    buyerCount: a.buyer_count,
    feedbackRate: a.feedback_rate,
    securityRate: a.security_rate,
    onlineStatus: a.online_status,
    totalServiceCount: a.total_service_count,
    communicationAddress: a.communication_address,
    chainIndex: a.chain_index,
    services: byAgent.get(a.agent_id) ?? [],
  }));
}
