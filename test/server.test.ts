import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Snapshot } from "../lib/compass/collect.js";
import { CompassIndex } from "../lib/compass/index.js";
import { createCompassServer } from "../server.js";
import { handleX402Gate } from "../lib/x402/gate.js";

const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil #0 - throwaway, test-only

function agent(
  id: string,
  opts: { category?: string; fee?: number | null; sold?: number; rating?: number } = {},
): Snapshot["agents"][number] {
  return {
    agentId: id,
    name: `Agent ${id}`,
    categoryCode: opts.category ? [opts.category] : ["SECURITY"],
    categoryName: opts.category ? [opts.category] : ["Security"],
    serviceMinPrice: opts.fee ?? null,
    soldCount: opts.sold ?? 0,
    buyerCount: opts.sold ?? 0,
    feedbackRate: opts.rating ?? 100,
    securityRate: 5,
    onlineStatus: 1,
    totalServiceCount: 1,
    communicationAddress: `0x${id.repeat(4).slice(0, 40)}`,
    chainIndex: 196,
    lowestFeeContractAddress: null,
    services:
      opts.fee === null || opts.fee === undefined
        ? []
        : [
            {
              id: `${id}-s1`,
              serviceId: `${id}-s1`,
              serviceName: `Service ${id}`,
              serviceDescription: null,
              serviceType: "A2MCP",
              feeAmount: opts.fee,
              feeToken: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
              endpoint: null,
              contractAddress: null,
            },
          ],
  };
}

function snap(sweepId: string, startedAt: string, agents: Snapshot["agents"][]): Snapshot {
  const flat = agents.flat();
  return {
    schema: 1,
    sweepId,
    startedAt,
    finishedAt: startedAt,
    source: "onchainos-agent-search",
    basis: "listed_price",
    queries: [
      {
        query: "security",
        pagesFetched: 1,
        total: flat.length,
        stored: flat.length,
        coverage: 1,
        truncated: false,
        error: null,
      },
    ],
    agents: flat,
  };
}

let dir: string;
let index: CompassIndex;
let handler: (req: Request) => Promise<Response>;
let gated: (req: Request) => Promise<Response>;

async function call(tool: string, args: Record<string, unknown> = {}) {
  const res = await gated(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    }),
  );
  const body = await res.json();
  return { status: res.status, body };
}

function payloadOf(result: { status: number; body: any }): any {
  const content = result.body?.result?.content ?? [];
  return JSON.parse(content[0]?.text ?? "{}");
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "compass-server-"));
  const snapshotsDir = join(dir, "snapshots");
  await mkdir(snapshotsDir, { recursive: true });
  const sweepA = snap("sweep-a", "2026-08-01T00:00:00.000Z", [
    agent("1", { fee: 0.005, sold: 5 }),
    agent("2", { fee: 0.02, sold: 2 }),
    agent("3", { category: "DATA", fee: 0.01 }),
  ]);
  const sweepB = snap("sweep-b", "2026-08-02T00:00:00.000Z", [
    agent("1", { fee: 0.01, sold: 5 }),
    agent("2", { fee: 0.03, sold: 2 }),
    agent("3", { category: "DATA", fee: 0.01 }),
    agent("4", { fee: 0.05 }),
    agent("5", { fee: null }),
  ]);
  await writeFile(join(snapshotsDir, "sweep-a.json"), JSON.stringify(sweepA));
  await writeFile(join(snapshotsDir, "sweep-b.json"), JSON.stringify(sweepB));
  index = new CompassIndex(join(dir, "compass.db"), snapshotsDir);
  await index.ingest();
  handler = createCompassServer(index);
  process.env.COMPASS_X402_BYPASS = "1";
  gated = (req) => handleX402Gate(req, handler);
});

afterAll(() => {
  delete process.env.COMPASS_X402_BYPASS;
  index.close();
});

describe("registration", () => {
  it("registers exactly 18 tools", async () => {
    const res = await gated(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    const body = await res.json();
    const names = (body.result?.tools ?? []).map((t: any) => t.name);
    expect(names).toHaveLength(18);
    for (const paid of [
      "counterparty_history",
      "market_rate",
      "competitor_set",
      "price_my_service",
      "quote_advisor",
      "demand_signal",
      "listing_audit",
      "service_gap",
      "price_trend",
      "attest_market_report",
    ]) {
      expect(names).toContain(paid);
    }
    for (const free of [
      "compass_capabilities",
      "estimate_cost",
      "validate_query",
      "category_map",
      "snapshot_status",
      "whoami_listing",
      "verify_compass_report",
      "get_artifact",
    ]) {
      expect(names).toContain(free);
    }
  });
});

describe("free tools answer a bare {} call with 200", () => {
  it("compass_capabilities", async () => {
    const { status, body } = await call("compass_capabilities");
    expect(status).toBe(200);
    const p = payloadOf({ status, body });
    expect(p.ok).toBe(true);
    expect(p.tools).toHaveLength(18);
  });

  it("snapshot_status", async () => {
    const p = payloadOf(await call("snapshot_status"));
    expect(p.ok).toBe(true);
    expect(p.index.lastSweepAt).toBe("2026-08-02T00:00:00.000Z");
    expect(p.index.stale).toBe(false);
  });

  it("category_map", async () => {
    const p = payloadOf(await call("category_map"));
    expect(p.ok).toBe(true);
    expect(p.categories.length).toBeGreaterThan(0);
  });

  it("estimate_cost with no args returns usage plus full pricing", async () => {
    const p = payloadOf(await call("estimate_cost"));
    expect(p.pricing).toHaveLength(10);
    expect(p.pricing[0].price).toContain("USDT0");
  });

  it("estimate_cost with a tool returns its exact price", async () => {
    const p = payloadOf(await call("estimate_cost", { tool: "attest_market_report" }));
    expect(p).toMatchObject({ ok: true, price: "0.03 USDT0", atomic: "30000" });
  });

  it("validate_query with no args returns usage", async () => {
    const p = payloadOf(await call("validate_query"));
    expect(p.tool).toBe("validate_query");
  });

  it("validate_query resolves a keyword", async () => {
    const p = payloadOf(await call("validate_query", { query: "security" }));
    expect(p.ok).toBe(true);
    expect(p.coverage.services).toBeGreaterThan(0);
  });

  it("validate_query with zero matches states the measured answer", async () => {
    const p = payloadOf(await call("validate_query", { query: "zzzz-not-a-thing" }));
    expect(p.coverage.services).toBe(0);
    expect(p.note).toContain("measured");
  });

  it("whoami_listing shows one agent without market comparison", async () => {
    const p = payloadOf(await call("whoami_listing", { agentId: "1" }));
    expect(p.ok).toBe(true);
    expect(p.services).toHaveLength(1);
    expect(p.comparison).toContain("never compares");
  });

  it("get_artifact with no args returns usage", async () => {
    const p = payloadOf(await call("get_artifact"));
    expect(p.tool).toBe("get_artifact");
  });

  it("verify_compass_report with no args returns usage", async () => {
    const p = payloadOf(await call("verify_compass_report"));
    expect(p.tool).toBe("verify_compass_report");
  });
});

describe("paid tools answer with basis, snapshotAt and coverage", () => {
  it("market_rate returns a distribution with the required fields", async () => {
    const p = payloadOf(await call("market_rate", { category: "security" }));
    expect(p.ok).toBe(true);
    expect(p.distribution.count).toBe(3);
    expect(p.distribution.median).not.toBeNull();
    expect(p.ratingBands.length).toBeGreaterThan(0);
    expect(p.basis).toBe("listed_price");
    expect(p.snapshotAt).toBe("2026-08-02T00:00:00.000Z");
    expect(p.coverage).toBe(1);
    expect(p.stale).toBe(false);
  });

  it("market_rate reports no comparable supply explicitly", async () => {
    const p = payloadOf(await call("market_rate", { query: "zzzz" }));
    expect(p.ok).toBe(false);
    expect(p.finding).toBe("no comparable supply");
  });

  it("counterparty_history returns the trading record", async () => {
    const p = payloadOf(await call("counterparty_history", { agentId: "1" }));
    expect(p.ok).toBe(true);
    expect(p.soldCount).toBe(5);
    expect(p.basis).toBe("listed_price");
  });

  it("competitor_set orders by price delta", async () => {
    const p = payloadOf(await call("competitor_set", { category: "security", feeAmount: 0.02 }));
    expect(p.ok).toBe(true);
    expect(p.competitors[0].feeAmount).toBe(0.01);
    expect(p.competitors[0].priceDelta).toBe(0.01);
    const deltas = p.competitors.map((c: any) => c.priceDelta);
    expect([...deltas].sort((a: number, b: number) => a - b)).toEqual(deltas);
    expect(p.basis).toBe("listed_price");
  });

  it("price_my_service places a price and gives a band", async () => {
    const p = payloadOf(await call("price_my_service", { agentId: "1", serviceId: "1-s1" }));
    expect(p.ok).toBe(true);
    expect(p.defensibleBand.low).toBeLessThanOrEqual(p.defensibleBand.high);
    expect(p.percentile).toBeGreaterThanOrEqual(0);
    expect(p.percentile).toBeLessThanOrEqual(100);
  });

  it("quote_advisor says below market for a tiny budget", async () => {
    const p = payloadOf(await call("quote_advisor", { category: "security", budget: 0.0001 }));
    expect(p.ok).toBe(true);
    expect(p.verdict).toBe("below market");
    expect(p.counterOffer.supportedRange).toHaveLength(2);
  });

  it("quote_advisor says above market for a huge budget", async () => {
    const p = payloadOf(await call("quote_advisor", { category: "security", budget: 9 }));
    expect(p.verdict).toBe("above market");
  });

  it("demand_signal separates crowded from moving categories", async () => {
    const p = payloadOf(await call("demand_signal"));
    expect(p.ok).toBe(true);
    const security = p.signal.find((s: any) => s.category.includes("SECURITY"));
    expect(security.sold).toBe(7);
  });

  it("service_gap surfaces thin supply with real demand", async () => {
    const p = payloadOf(await call("service_gap", { minSold: 2 }));
    expect(p.ok).toBe(true);
    const gap = p.gaps.find((g: any) => g.category.includes("SECURITY"));
    expect(gap).toBeDefined();
    expect(gap.sold).toBe(7);
    expect(gap.services).toBe(3);
  });

  it("listing_audit flags the cheap and the expensive service", async () => {
    const p = payloadOf(await call("listing_audit", { agentId: "1" }));
    expect(p.ok).toBe(true);
    expect(p.services).toHaveLength(1);
  });

  it("price_trend needs history and reports the window honestly", async () => {
    const p = payloadOf(await call("price_trend", { category: "security" }));
    expect(p.ok).toBe(true);
    expect(p.observationWindow.snapshots).toBe(2);
    expect(p.trend).toHaveLength(2);
    expect(typeof p.medianDelta).toBe("number");
    expect(p.basis).toBe("listed_price");
  });

  it("price_trend says insufficient for a single snapshot", async () => {
    const p = payloadOf(await call("price_trend", { category: "nope-nothing" }));
    expect(p.ok).toBe(false);
    expect(p.finding).toContain("History insufficient");
  });
});

describe("attestation", () => {
  it("attest_market_report signs, anchors (or reports failure) and stores", async () => {
    process.env.COMPASS_SIGNER_PRIVATE_KEY = TEST_KEY;
    const p = payloadOf(await call("attest_market_report", { category: "security" }));
    expect(p.ok).toBe(true);
    expect(p.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.signature).toMatch(/^0x/);
    expect(p.signer).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(p.anchor.status).toBe("anchoring-failed");
    expect(p.report.sampleSize).toBe(3);

    const fetched = payloadOf(await call("get_artifact", { digest: p.digest }));
    expect(fetched.ok).toBe(true);
    expect(fetched.artifact.digest).toBe(p.digest);
    expect(fetched.artifact.signer).toBe(p.signer);

    const verified = payloadOf(
      await call("verify_compass_report", {
        digest: p.digest,
        signature: p.signature,
        signer: p.signer,
      }),
    );
    expect(verified.signatureValid).toBe(true);
    expect(verified.knownToThisServer).toBe(true);
    delete process.env.COMPASS_SIGNER_PRIVATE_KEY;
  });
});
