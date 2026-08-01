import { LatestAgentRow, ServiceRow } from "./store.js";
import { distribution } from "./stats.js";

export const NO_COMPARABLE_SUPPLY = "no comparable supply";

export interface ComparableService {
  serviceId: string;
  agentId: string;
  agentName: string | null;
  serviceName: string | null;
  serviceType: string | null;
  feeAmount: number | null;
  soldCount: number | null;
  feedbackRate: number | null;
  securityRate: number | null;
  category: string | null;
}

export interface CompetitorRow extends ComparableService {
  priceDelta: number;
}

export interface ServiceFilter {
  category?: string | null;
  serviceType?: string | null;
  query?: string;
  feeToken?: string | null;
}

function categoryOf(agent: LatestAgentRow): string | null {
  const joined = [agent.categoryCode, agent.categoryName].filter(Boolean).join(" ");
  return joined.trim() === "" ? null : joined;
}

export function collectServices(
  agents: LatestAgentRow[],
  filter: ServiceFilter = {},
): ComparableService[] {
  const q = filter.query?.toLowerCase();
  const cat = filter.category?.toLowerCase();
  const type = filter.serviceType?.toLowerCase();
  const out: ComparableService[] = [];
  for (const agent of agents) {
    const category = categoryOf(agent);
    if (cat && !(category ?? "").toLowerCase().includes(cat)) continue;
    const haystack = [agent.name, category].filter(Boolean).join(" ").toLowerCase();
    for (const svc of agent.services) {
      if (type && !(svc.type ?? "").toLowerCase().includes(type)) continue;
      if (q) {
        const serviceHay = [svc.name, svc.description, svc.type].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q) && !serviceHay.includes(q)) continue;
      }
      if (filter.feeToken && svc.feeToken && svc.feeToken !== filter.feeToken) continue;
      out.push({
        serviceId: svc.serviceId,
        agentId: agent.agentId,
        agentName: agent.name,
        serviceName: svc.name,
        serviceType: svc.type,
        feeAmount: svc.feeAmount,
        soldCount: agent.soldCount,
        feedbackRate: agent.feedbackRate,
        securityRate: agent.securityRate,
        category,
      });
    }
  }
  return out;
}

export interface CompetitorSetResult {
  competitors: CompetitorRow[];
  total: number;
  finding: string | null;
}

export function competitorSet(
  services: ComparableService[],
  target: {
    feeAmount: number | null;
    category?: string | null;
    serviceType?: string | null;
    limit?: number;
    excludeServiceId?: string;
  },
): CompetitorSetResult {
  const limit = target.limit ?? 10;
  const cat = target.category?.toLowerCase();
  const type = target.serviceType?.toLowerCase();
  const candidates = services.filter(
    (s) =>
      s.feeAmount !== null &&
      s.feeAmount !== undefined &&
      s.serviceId !== target.excludeServiceId &&
      (!cat || (s.category ?? "").toLowerCase().includes(cat)) &&
      (!type || (s.serviceType ?? "").toLowerCase().includes(type)),
  );
  const priced = candidates
    .map((s) => ({
      ...s,
      priceDelta: Math.round(Math.abs((s.feeAmount as number) - (target.feeAmount ?? 0)) * 1e6) / 1e6,
    }))
    .sort(
      (a, b) =>
        a.priceDelta - b.priceDelta ||
        (b.soldCount ?? 0) - (a.soldCount ?? 0) ||
        (a.feeAmount as number) - (b.feeAmount as number),
    );
  if (priced.length === 0) {
    return {
      competitors: [],
      total: 0,
      finding: NO_COMPARABLE_SUPPLY,
    };
  }
  return {
    competitors: priced.slice(0, limit),
    total: priced.length,
    finding: null,
  };
}

export interface Placement {
  percentile: number;
  below: number | null;
  above: number | null;
  count: number;
}

export function placement(
  price: number,
  services: ComparableService[],
): Placement {
  const fees = services
    .map((s) => s.feeAmount)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v))
    .sort((a, b) => a - b);
  const count = fees.length;
  if (count === 0) {
    return { percentile: 0, below: null, above: null, count: 0 };
  }
  const atOrBelow = fees.filter((f) => f < price).length;
  const percentile = (atOrBelow / count) * 100;
  const below = fees.filter((f) => f < price).pop() ?? null;
  const above = fees.find((f) => f > price) ?? null;
  return { percentile, below, above, count };
}

export interface PriceBand {
  low: number;
  high: number;
  count: number;
}

export function priceBand(services: ComparableService[]): PriceBand | null {
  const fees = services
    .map((s) => s.feeAmount)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (fees.length === 0) return null;
  const d = distribution(fees);
  if (d.p25 === null || d.p75 === null) return null;
  return { low: d.p25, high: d.p75, count: fees.length };
}
