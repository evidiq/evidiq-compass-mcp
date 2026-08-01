import { describe, expect, it } from "vitest";
import {
  collectServices,
  competitorSet,
  NO_COMPARABLE_SUPPLY,
  placement,
  priceBand,
} from "../lib/compass/compare.js";
import { LatestAgentRow } from "../lib/compass/store.js";

function svc(
  agentId: string,
  serviceId: string,
  opts: { name?: string; type?: string; fee?: number; description?: string; categoryCode?: string; categoryName?: string } = {},
): LatestAgentRow {
  return {
    agentId,
    name: `Agent ${agentId}`,
    categoryCode: opts.categoryCode ?? "SECURITY",
    categoryName: opts.categoryName ?? "Security",
    serviceMinPrice: opts.fee ?? null,
    soldCount: 0,
    buyerCount: null,
    feedbackRate: 100,
    securityRate: 5,
    onlineStatus: 1,
    totalServiceCount: 1,
    communicationAddress: null,
    chainIndex: 196,
    services: [
      {
        serviceId,
        id: serviceId,
        name: opts.name ?? `Service ${serviceId}`,
        description: opts.description ?? null,
        type: opts.type ?? "A2MCP",
        feeAmount: opts.fee ?? null,
        feeToken: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        endpoint: null,
      },
    ],
  };
}

const market: LatestAgentRow[] = [
  svc("1", "s1", { name: "Security Scan", type: "A2MCP", fee: 0.005 }),
  svc("2", "s2", { name: "Security Monitor", type: "A2MCP", fee: 0.02 }),
  svc("3", "s3", { name: "Security Audit", type: "A2A", fee: 0.05 }),
  svc("4", "s4", { name: "Token Data", type: "A2MCP", fee: 0.01, categoryCode: "DATA", categoryName: "Data" }),
];

describe("collectServices", () => {
  it("collects all services with agent context", () => {
    const all = collectServices(market);
    expect(all).toHaveLength(4);
    expect(all[0]).toMatchObject({ agentId: "1", serviceName: "Security Scan", feeAmount: 0.005 });
  });

  it("filters by category", () => {
    const byCat = collectServices(market, { category: "data" });
    expect(byCat.map((s) => s.serviceId)).toEqual(["s4"]);
  });

  it("filters by service type", () => {
    const byType = collectServices(market, { serviceType: "A2A" });
    expect(byType.map((s) => s.serviceId)).toEqual(["s3"]);
  });

  it("filters by keyword across agent and service text", () => {
    expect(collectServices(market, { query: "audit" }).map((s) => s.serviceId)).toEqual(["s3"]);
    expect(collectServices(market, { query: "agent 2" }).map((s) => s.serviceId)).toEqual(["s2"]);
  });
});

describe("competitorSet", () => {
  it("orders by price delta with sold count tiebreak", () => {
    const services = collectServices(market);
    const { competitors, total, finding } = competitorSet(services, {
      feeAmount: 0.02,
      category: "security",
    });
    expect(total).toBe(3);
    expect(finding).toBeNull();
    expect(competitors[0].serviceId).toBe("s2");
    expect(competitors.map((c) => c.priceDelta)).toEqual([0, 0.015, 0.03]);
  });

  it("respects the limit", () => {
    const services = collectServices(market);
    const { competitors } = competitorSet(services, { feeAmount: 0.02, limit: 2 });
    expect(competitors).toHaveLength(2);
  });

  it("excludes the target service itself", () => {
    const services = collectServices(market);
    const { competitors } = competitorSet(services, { feeAmount: 0.02, excludeServiceId: "s2" });
    expect(competitors.some((c) => c.serviceId === "s2")).toBe(false);
  });

  it("reports no comparable supply explicitly", () => {
    const { competitors, finding } = competitorSet([], { feeAmount: 0.02, category: "security" });
    expect(competitors).toEqual([]);
    expect(finding).toBe(NO_COMPARABLE_SUPPLY);
  });
});

describe("placement", () => {
  it("places a price in the middle at ~50th percentile", () => {
    const services = collectServices(market);
    const p = placement(0.02, services);
    expect(p.percentile).toBe(50);
    expect(p.below).toBe(0.01);
    expect(p.above).toBe(0.05);
    expect(p.count).toBe(4);
  });

  it("places at 100 when above everything and 0 when below", () => {
    const services = collectServices(market);
    expect(placement(0.1, services).percentile).toBe(100);
    expect(placement(0.001, services).percentile).toBe(0);
  });

  it("is empty for zero supply", () => {
    expect(placement(0.02, [])).toEqual({ percentile: 0, below: null, above: null, count: 0 });
  });
});

describe("priceBand", () => {
  it("computes the p25-p75 band", () => {
    const services = collectServices(market);
    const band = priceBand(services);
    expect(band).not.toBeNull();
    expect(band!.count).toBe(4);
  });

  it("is null when there is no priced supply", () => {
    const noPrice = [svc("9", "s9", { fee: null })];
    expect(priceBand(noPrice)).toBeNull();
  });
});
