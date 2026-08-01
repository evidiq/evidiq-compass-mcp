import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarketplaceAgent, Snapshot } from "../lib/compass/collect.js";
import {
  importSnapshot,
  latestAgents,
  latestSnapshot,
  listSnapshots,
  openStore,
} from "../lib/compass/store.js";

function makeAgent(id: string, fee: number | null = 0.01): MarketplaceAgent {
  return {
    agentId: id,
    name: `Agent ${id}`,
    categoryCode: ["SOFTWARE_SERVICES"],
    categoryName: ["Software services"],
    serviceMinPrice: fee,
    soldCount: id === "1" ? 5 : 0,
    buyerCount: 1,
    feedbackRate: 100,
    securityRate: 5,
    onlineStatus: 1,
    totalServiceCount: 1,
    communicationAddress: "0xabc",
    chainIndex: 196,
    lowestFeeContractAddress: null,
    services: [
      {
        id: `${id}-s1`,
        serviceId: `${id}-s1`,
        serviceName: `Service ${id}`,
        serviceDescription: null,
        serviceType: "A2MCP",
        feeAmount: fee,
        feeToken: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        endpoint: null,
        contractAddress: null,
      },
    ],
  };
}

function makeSnapshot(
  agents: MarketplaceAgent[],
  queries = ["security"],
  sweepId = `sweep-${agents.map((a) => a.agentId).join("-")}`,
  startedAt = "2026-08-02T00:00:00.000Z",
): Snapshot {
  return {
    schema: 1,
    sweepId,
    startedAt,
    finishedAt: "2026-08-02T00:01:00.000Z",
    source: "onchainos-agent-search",
    basis: "listed_price",
    queries: queries.map((q) => ({
      query: q,
      pagesFetched: 1,
      total: agents.length,
      stored: agents.length,
      coverage: 1,
      truncated: false,
      error: null,
    })),
    agents,
  };
}

let dir: string;
let dbPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "compass-store-"));
  dbPath = join(dir, "compass.db");
});

afterEach(() => {});

describe("store", () => {
  it("initializes the schema and starts empty", () => {
    const db = openStore(dbPath);
    expect(latestSnapshot(db)).toBeNull();
    expect(latestAgents(db)).toEqual([]);
    expect(listSnapshots(db)).toEqual([]);
    db.close();
  });

  it("imports a snapshot and reads it back", () => {
    const db = openStore(dbPath);
    importSnapshot(db, makeSnapshot([makeAgent("1"), makeAgent("2")]));
    const latest = latestSnapshot(db);
    expect(latest).toMatchObject({
      nAgents: 2,
      nServices: 2,
      minCoverage: 1,
    });
    const agents = latestAgents(db);
    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({
      agentId: "1",
      soldCount: 5,
    });
    expect(agents[0].services).toHaveLength(1);
    expect(agents[0].services[0].feeAmount).toBe(0.01);
    db.close();
  });

  it("re-importing the same sweep is idempotent", () => {
    const db = openStore(dbPath);
    const snap = makeSnapshot([makeAgent("1")]);
    importSnapshot(db, snap);
    importSnapshot(db, snap);
    expect(listSnapshots(db)).toHaveLength(1);
    expect(latestAgents(db)).toHaveLength(1);
    db.close();
  });

  it("keeps history append-only across sweeps", () => {
    const db = openStore(dbPath);
    importSnapshot(db, makeSnapshot([makeAgent("1", 0.01)], ["security"], "sweep-a", "2026-08-01T00:00:00.000Z"));
    importSnapshot(db, makeSnapshot([makeAgent("2", 0.05)], ["security"], "sweep-b", "2026-08-02T00:00:00.000Z"));
    expect(listSnapshots(db)).toHaveLength(2);
    expect(latestAgents(db).map((a) => a.agentId)).toEqual(["2"]);
    db.close();
  });

  it("computes min coverage across queries", () => {
    const db = openStore(dbPath);
    const snap: Snapshot = {
      schema: 1,
      sweepId: "partial",
      startedAt: "2026-08-02T00:00:00.000Z",
      finishedAt: "2026-08-02T00:01:00.000Z",
      source: "onchainos-agent-search",
      basis: "listed_price",
      queries: [
        {
          query: "a",
          pagesFetched: 1,
          total: 100,
          stored: 100,
          coverage: 1,
          truncated: false,
          error: null,
        },
        {
          query: "b",
          pagesFetched: 1,
          total: 100,
          stored: 50,
          coverage: 0.5,
          truncated: true,
          error: null,
        },
      ],
      agents: [],
    };
    importSnapshot(db, snap);
    expect(latestSnapshot(db)?.minCoverage).toBe(0.5);
    db.close();
  });

  it("stores service price history across sweeps for trend queries", () => {
    const db = openStore(dbPath);
    importSnapshot(db, makeSnapshot([makeAgent("1", 0.01)], ["security"], "sweep-a", "2026-08-01T00:00:00.000Z"));
    importSnapshot(db, makeSnapshot([makeAgent("1", 0.03)], ["security"], "sweep-b", "2026-08-02T00:00:00.000Z"));
    const list = listSnapshots(db);
    expect(list).toHaveLength(2);
    const prices = db
      .prepare(
        `SELECT service_min_price FROM agents WHERE agent_id = '1' ORDER BY sweep_id`,
      )
      .all()
      .map((r) => (r as { service_min_price: number }).service_min_price);
    expect(prices).toEqual([0.01, 0.03]);
    db.close();
  });
});
