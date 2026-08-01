import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { CompassIndex } from "./lib/compass/index.js";
import {
  collectServices,
  competitorSet,
  placement,
  priceBand,
  NO_COMPARABLE_SUPPLY,
} from "./lib/compass/compare.js";
import { distribution, mean, ratingBands } from "./lib/compass/stats.js";
import { reportDigest, signDigest, requireSigner, canonicalPayload, verifySignature, getSignerAddress } from "./lib/compass/report.js";
import { saveArtifact, getArtifact, pricesPerSweep, LatestAgentRow } from "./lib/compass/store.js";
import { anchorToOgStorage } from "./lib/og/storage.js";
import { TOOL_PRICES_ATOMIC, TOOL_PRICES_HUMAN, FREE_TOOL_NAMES } from "./lib/x402/challenge.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function validationError(message: string) {
  return textResult({ ok: false, error: message });
}

function usageFor(tool: string, description: string, fields: Record<string, string>): Record<string, unknown> {
  return {
    ok: false,
    tool,
    usage: description,
    fields,
    hint: "Every field is optional; supply at least one to get an answer.",
  };
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function categoryKey(agent: LatestAgentRow): string {
  return [agent.categoryCode, agent.categoryName].filter(Boolean).join(" | ");
}

interface SnapshotCtx {
  basis: "listed_price";
  snapshotAt: string | null;
  coverage: number | null;
  stale: boolean;
  ageSeconds: number | null;
}

function snapshotCtx(index: CompassIndex): SnapshotCtx {
  const state = index.state();
  return {
    basis: "listed_price",
    snapshotAt: state.lastSweepAt,
    coverage: state.minCoverage,
    stale: state.stale,
    ageSeconds: state.ageSeconds,
  };
}

export function createCompassServer(index: CompassIndex) {
  const INSTRUCTIONS = `EVIDIQ Compass MCP — pricing and demand intelligence for the OKX.AI agent market. 18 tools (8 free, 10 paid).

Free tools (always 200): compass_capabilities, estimate_cost, validate_query, category_map, snapshot_status, whoami_listing, verify_compass_report, get_artifact.

Paid tools (x402-gated, USDT0 on eip155:196): counterparty_history (0.005), market_rate (0.01), competitor_set (0.01), price_my_service (0.015), quote_advisor (0.015), demand_signal (0.02), listing_audit (0.02), service_gap (0.02), price_trend (0.02), attest_market_report (0.03). Payment settles before work begins.

Data basis: every price in every answer is a LISTED price (feeAmount), never a settled one. soldCount is per agent, not per service. Every paid answer carries snapshotAt, coverage (measured against the API's reported total) and stale (a snapshot older than its freshness budget is served with its age, never quietly). No model computes any statistic; percentiles and medians are arithmetic. Compass reads, ranks and explains — it never writes to the market.`;

  const handler = createMcpHandler(
    (server) => {
      // ── FREE 1: compass_capabilities ────────────────────────────────────
      server.registerTool(
        "compass_capabilities",
        {
          title: "Compass capabilities: tools, prices, data basis and limits",
          description:
            "Everything a buyer needs to decide: all 18 tools with prices, the data basis (listed prices, per-agent sold counts), the claim limits, snapshot freshness and coverage from the real index. Free.",
          inputSchema: {},
        },
        async () => {
          const state = index.state();
          const paid = Object.entries(TOOL_PRICES_HUMAN).map(([tool, price]) => ({
            tool,
            price,
            paid: true,
            atomic: TOOL_PRICES_ATOMIC[tool],
          }));
          const free = FREE_TOOL_NAMES.map((tool) => ({ tool, price: "0", paid: false }));
          return textResult({
            ok: true,
            service: "EVIDIQ Compass — Market Position for Agent Services",
            tools: [...paid, ...free].sort((a, b) => a.tool.localeCompare(b.tool)),
            dataBasis: {
              prices: "feeAmount as listed on the marketplace — listed, never settled",
              soldCount: "per agent, not per service",
              coverage: "measured against the API's reported total; a short pagination loop says so",
              stale: "a snapshot older than the freshness budget is served with its age, never quietly",
              statistics: "pure arithmetic — no model computes any percentile",
            },
            limits: {
              writes: "Compass never writes to the market: no price changes, no tasks, no contact",
              historical: "price_trend only reaches as far back as Compass's own snapshot history",
            },
            index: {
              lastSweepAt: state.lastSweepAt,
              agents: state.agents,
              services: state.services,
              minCoverage: state.minCoverage,
              stale: state.stale,
              snapshotsHeld: state.snapshots,
            },
            signer: getSignerAddress(),
          });
        },
      );

      // ── FREE 2: estimate_cost ────────────────────────────────────────────
      server.registerTool(
        "estimate_cost",
        {
          title: "Exact price of any paid tool",
          description:
            "Exact atomic and human price for any paid tool, from the same table the gate charges from. Never invents an answer: an unknown tool name is an error. Free.",
          inputSchema: { tool: z.string().optional().describe("Paid tool name, e.g. market_rate.") },
        },
        async ({ tool }) => {
          const name = normalizeText(tool);
          if (!name) {
            return textResult({
              ok: false,
              ...usageFor("estimate_cost", "Exact atomic and human price of any paid tool.", {
                tool: "The paid tool name, e.g. market_rate.",
              }),
              pricing: Object.entries(TOOL_PRICES_HUMAN).map(([t, price]) => ({
                tool: t,
                price,
                atomic: TOOL_PRICES_ATOMIC[t],
              })),
            });
          }
          if (!(name in TOOL_PRICES_ATOMIC)) {
            return validationError(`Unknown tool '${name}'. Paid tools: ${Object.keys(TOOL_PRICES_ATOMIC).join(", ")}.`);
          }
          return textResult({
            ok: true,
            tool: name,
            price: TOOL_PRICES_HUMAN[name],
            atomic: TOOL_PRICES_ATOMIC[name],
            network: "eip155:196",
            asset: process.env.X402_ASSET || "0x779ded0c9e1022225f8e0630b35a9b54be713736",
          });
        },
      );

      // ── FREE 3: validate_query ───────────────────────────────────────────
      server.registerTool(
        "validate_query",
        {
          title: "Resolve a category or keyword before paying",
          description:
            "Resolves a category, keyword or service type against the local index and reports how many services it would cover, before anything is paid for. Counts are free; prices are not.",
          inputSchema: {
            query: z.string().optional().describe("Keyword matched against agent names, categories, service names and descriptions."),
            category: z.string().optional().describe("Category code or name, e.g. SECURITY or Software services."),
            serviceType: z.string().optional().describe("Service type, e.g. A2MCP or A2A."),
          },
        },
        async (args) => {
          const query = normalizeText(args.query);
          const category = normalizeText(args.category);
          const serviceType = normalizeText(args.serviceType);
          if (!query && !category && !serviceType) {
            return textResult(
              usageFor("validate_query", "Resolve a category or keyword and learn how many services it covers.", {
                query: "Keyword in agent/service text.",
                category: "Category code or name.",
                serviceType: "Service type, e.g. A2MCP.",
              }),
            );
          }
          const services = collectServices(index.agents(), { query: query || undefined, category: category || undefined, serviceType: serviceType || undefined });
          const categories = new Set<string>();
          for (const s of services) {
            if (s.category) categories.add(s.category);
          }
          const agents = new Set(services.map((s) => s.agentId)).size;
          return textResult({
            ok: true,
            resolved: { query: query || null, category: category || null, serviceType: serviceType || null },
            coverage: { services: services.length, agents, categories: [...categories].slice(0, 20) },
            note:
              services.length === 0
                ? "No service in the local index matches. Note: the upstream search API falls back to the full marketplace for unmatched keywords; an index match of zero is Compass's measured answer, not the API's."
                : "Paid tools market_rate, competitor_set, price_my_service and quote_advisor would run over this set.",
          });
        },
      );

      // ── FREE 4: category_map ─────────────────────────────────────────────
      server.registerTool(
        "category_map",
        {
          title: "Category taxonomy with service counts",
          description:
            "The category taxonomy with service counts per category, and the agents behind them. Counts are free; prices are not — no fee amounts appear here.",
          inputSchema: { category: z.string().optional().describe("Optional category to focus on.") },
        },
        async ({ category }) => {
          const agents = index.agents();
          const byCategory = new Map<string, { agents: number; services: number; sold: number }>();
          for (const a of agents) {
            const key = categoryKey(a);
            const entry = byCategory.get(key) ?? { agents: 0, services: 0, sold: 0 };
            entry.agents++;
            entry.services += a.services.length;
            entry.sold += a.soldCount ?? 0;
            byCategory.set(key, entry);
          }
          const cat = normalizeText(category);
          let rows = [...byCategory.entries()].map(([name, counts]) => ({ category: name, ...counts }));
          if (cat) {
            rows = rows.filter((r) => r.category.toLowerCase().includes(cat.toLowerCase()));
          }
          rows.sort((a, b) => b.services - a.services);
          return textResult({
            ok: true,
            countsOnly: "Free. Price statistics for any category cost 0.01 USDT0 (market_rate).",
            categories: rows.slice(0, 50),
            totalAgents: agents.length,
          });
        },
      );

      // ── FREE 5: snapshot_status ──────────────────────────────────────────
      server.registerTool(
        "snapshot_status",
        {
          title: "Freshness and coverage of the local index",
          description:
            "When the index last refreshed, how many agents and services it holds, coverage per the sweep's real result, whether it is stale, and how many snapshots are held. Free.",
          inputSchema: {},
        },
        async () => {
          const state = index.state();
          return textResult({
            ok: true,
            index: state,
            budgetHours: 7,
            note: state.stale
              ? "The index is stale — price answers carry stale:true and their age."
              : "The index is within its freshness budget.",
          });
        },
      );

      // ── FREE 6: whoami_listing ───────────────────────────────────────────
      server.registerTool(
        "whoami_listing",
        {
          title: "How Compass sees one agent's own listing",
          description:
            "How Compass currently sees one agent's public listing — services, listed prices, sold count, ratings — with no market comparison, so a seller can confirm they are indexed correctly before paying for advice.",
          inputSchema: { agentId: z.string().optional().describe("The marketplace agent id, e.g. 5232.") },
        },
        async ({ agentId }) => {
          const id = normalizeText(agentId);
          if (!id) {
            return textResult(
              usageFor("whoami_listing", "How Compass sees one agent's listing, with no market comparison.", {
                agentId: "The marketplace agent id.",
              }),
            );
          }
          const agents = index.agents();
          const agent = agents.find((a) => a.agentId === id);
          if (!agent) {
            return validationError(
              `Agent ${id} is not in the current snapshot. If it is indexed, it may appear under a different id.`,
            );
          }
          return textResult({
            ok: true,
            agentId: id,
            name: agent.name,
            category: [agent.categoryCode, agent.categoryName].filter(Boolean).join(" | "),
            soldCount: agent.soldCount,
            buyerCount: agent.buyerCount,
            feedbackRate: agent.feedbackRate,
            securityRate: agent.securityRate,
            onlineStatus: agent.onlineStatus === 1 ? "online" : agent.onlineStatus === 0 ? "offline" : String(agent.onlineStatus),
            serviceCount: agent.services.length,
            services: agent.services.map((s) => ({
              serviceId: s.serviceId,
              name: s.name,
              type: s.type,
              feeAmount: s.feeAmount,
              feeToken: s.feeToken,
              endpoint: s.endpoint,
            })),
            comparison: "None — whoami_listing never compares against the market.",
          });
        },
      );

      // ── FREE 7: verify_compass_report ────────────────────────────────────
      server.registerTool(
        "verify_compass_report",
        {
          title: "Verify a Compass report's signature and digest",
          description:
            "Verifies the JCS digest and EIP-191 signature of a Compass report. Give the report object, or the digest/signature/signer triple. Free.",
          inputSchema: {
            report: z.any().optional().describe("The report object as returned by a paid tool."),
            digest: z.string().optional().describe("The SHA-256 digest to verify."),
            signature: z.string().optional().describe("The 0x EIP-191 signature."),
            signer: z.string().optional().describe("The expected signer address."),
          },
        },
        async ({ report, digest, signature, signer }) => {
          const sig = normalizeText(signature);
          const dg = normalizeText(digest);
          const sn = normalizeText(signer);
          const payload = (report ?? {}) as Record<string, unknown>;
          const computed = report
            ? reportDigest({
                query: String(payload.query ?? ""),
                basis: String(payload.basis ?? ""),
                snapshotAt: String(payload.snapshotAt ?? ""),
                coverage: (payload.coverage as number | null) ?? null,
                sampleSize: Number(payload.sampleSize ?? 0),
                stats: payload.stats ?? {},
                rows: payload.rows ?? [],
              })
            : dg;
          if (!computed || (report && !dg && !sig)) {
            return textResult(
              usageFor("verify_compass_report", "Verify a Compass report's digest and signature.", {
                report: "The report object, as returned by a paid tool.",
                digest: "Digest to verify (used with signature + signer).",
                signature: "0x EIP-191 signature.",
                signer: "Expected signer address.",
              }),
            );
          }
          const stored = getArtifact(index.dbHandle(), computed);
          const verifierAddress = sn || stored?.signer || null;
          let signatureValid: boolean | null = null;
          const digestHex = computed.startsWith("0x") ? computed : `0x${computed}`;
          if (sig && verifierAddress && /^0x[0-9a-fA-F]{64}$/.test(digestHex)) {
            signatureValid = await verifySignature(digestHex, sig as `0x${string}`, verifierAddress as `0x${string}`);
          }
          const knownDigest = Boolean(stored);
          return textResult({
            ok: signatureValid !== false,
            digest: computed,
            recomputedFromReport: Boolean(report),
            signatureValid,
            expectedSigner: verifierAddress,
            fleetSigner: getSignerAddress(),
            knownToThisServer: knownDigest,
            note: signatureValid === null
              ? "No signature provided to check. Pass signature + signer (or fetch get_artifact by digest) to verify an existing report."
              : signatureValid
                ? "Signature verified against the expected signer."
                : "Signature does not match the expected signer.",
          });
        },
      );

      // ── FREE 8: get_artifact ─────────────────────────────────────────────
      server.registerTool(
        "get_artifact",
        {
          title: "Retrieve a stored report by digest",
          description:
            "Retrieves a previously attested market report by its digest, including the signature, signer and 0G anchor if present. Free.",
          inputSchema: { digest: z.string().optional().describe("The report digest to retrieve.") },
        },
        async ({ digest }) => {
          const dg = normalizeText(digest);
          if (!dg) {
            return textResult(
              usageFor("get_artifact", "Retrieve a stored report by digest.", {
                digest: "The report digest, as returned by attest_market_report.",
              }),
            );
          }
          const artifact = getArtifact(index.dbHandle(), dg);
          if (!artifact) {
            return validationError(`No stored report with digest ${dg}.`);
          }
          return textResult({ ok: true, artifact });
        },
      );

      // ── PAID 1: counterparty_history ─────────────────────────────────────
      server.registerTool(
        "counterparty_history",
        {
          title: "Public trading record of one agent",
          description:
            "The public trading record of one agent: sold count, buyer count, feedback rate, security rate, listing status, online status, service count. Called before accepting a task from a stranger. Costs 0.005 USDT0.",
          inputSchema: { agentId: z.string().describe("The marketplace agent id to investigate.") },
        },
        async ({ agentId }) => {
          const id = normalizeText(agentId);
          if (!id) return validationError("agentId is required.");
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) {
            return validationError("No snapshot ingested yet — run the collector and ingest before asking.");
          }
          const agent = index.agents().find((a) => a.agentId === id);
          if (!agent) {
            return textResult({
              ok: false,
              finding: `Agent ${id} is not in the current snapshot (coverage ${ctx.coverage === null ? "unmeasured" : `${Math.round(ctx.coverage * 100)}%`}). It may exist but not be indexed.`,
              ...ctx,
            });
          }
          return textResult({
            ok: true,
            agentId: id,
            name: agent.name,
            category: [agent.categoryCode, agent.categoryName].filter(Boolean).join(" | "),
            soldCount: agent.soldCount,
            buyerCount: agent.buyerCount,
            feedbackRate: agent.feedbackRate,
            securityRate: agent.securityRate,
            onlineStatus: agent.onlineStatus === 1 ? "online" : agent.onlineStatus === 0 ? "offline" : String(agent.onlineStatus),
            serviceCount: agent.services.length,
            serviceMinPrice: agent.serviceMinPrice,
            communicationAddress: agent.communicationAddress,
            finding:
              agent.soldCount === 0
                ? "This provider has never sold on record."
                : agent.feedbackRate !== null && agent.feedbackRate >= 95
                  ? "Established provider with a high feedback rate."
                  : "Trade record exists — verify before transacting.",
            ...ctx,
          });
        },
      );

      // ── PAID 2: market_rate ──────────────────────────────────────────────
      server.registerTool(
        "market_rate",
        {
          title: "Price distribution for a category or keyword",
          description:
            "Price distribution for a category or keyword: min, p25, median, p75, max, service count, and the spread of provider ratings at each price band. Costs 0.01 USDT0.",
          inputSchema: {
            query: z.string().optional().describe("Keyword in agent/service text."),
            category: z.string().optional().describe("Category code or name."),
            serviceType: z.string().optional().describe("Service type, e.g. A2MCP."),
          },
        },
        async (args) => {
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) return validationError("No snapshot ingested yet.");
          const services = collectServices(index.agents(), {
            query: normalizeText(args.query) || undefined,
            category: normalizeText(args.category) || undefined,
            serviceType: normalizeText(args.serviceType) || undefined,
          });
          const fees = services.map((s) => s.feeAmount).filter((v): v is number => v !== null && v !== undefined);
          if (fees.length === 0) {
            return textResult({
              ok: false,
              finding: NO_COMPARABLE_SUPPLY,
              resolved: { query: args.query ?? null, category: args.category ?? null, serviceType: args.serviceType ?? null },
              ...ctx,
            });
          }
          const d = distribution(fees);
          const ratings = services.map((s) => s.feedbackRate ?? NaN);
          return textResult({
            ok: true,
            basisNote: "feeAmount is a listed price, never a settled one.",
            resolved: { query: args.query ?? null, category: args.category ?? null, serviceType: args.serviceType ?? null },
            distribution: { ...d, mean: mean(fees) },
            ratingBands: ratingBands(fees, ratings),
            providerCount: new Set(services.map((s) => s.agentId)).size,
            ...ctx,
          });
        },
      );

      // ── PAID 3: competitor_set ───────────────────────────────────────────
      server.registerTool(
        "competitor_set",
        {
          title: "Closest comparable services to one service",
          description:
            "The closest comparable services to a given one, by category, type and price, each with its provider's sold count and rating. Costs 0.01 USDT0.",
          inputSchema: {
            agentId: z.string().optional().describe("Agent whose service is the target (with serviceId or on its own)."),
            serviceId: z.string().optional().describe("Exact service id of the target."),
            category: z.string().optional().describe("Category to compare within."),
            serviceType: z.string().optional().describe("Service type to compare within."),
            feeAmount: z.number().optional().describe("Explicit target listed price, if not resolving a service."),
            limit: z.number().optional().describe("How many competitors to return (default 10)."),
          },
        },
        async (args) => {
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) return validationError("No snapshot ingested yet.");
          const agents = index.agents();
          let target: { feeAmount: number | null; category?: string | null; serviceType?: string | null; serviceId?: string } | null = null;
          const sid = normalizeText(args.serviceId);
          const aid = normalizeText(args.agentId);
          if (sid || aid) {
            const agent = agents.find((a) => a.agentId === aid);
            const service = agent?.services.find((s) => s.serviceId === sid || s.id === sid);
            if (service && service.feeAmount !== null && service.feeAmount !== undefined && agent) {
              target = {
                feeAmount: service.feeAmount,
                category: [agent.categoryCode, agent.categoryName].filter(Boolean).join(" "),
                serviceType: service.type,
                serviceId: service.serviceId,
              };
            } else if (agent && agent.serviceMinPrice !== null && agent.serviceMinPrice !== undefined) {
              target = {
                feeAmount: agent.serviceMinPrice,
                category: [agent.categoryCode, agent.categoryName].filter(Boolean).join(" "),
                serviceType: undefined,
                serviceId: undefined,
              };
            }
          }
          if (!target) {
            target = {
              feeAmount: args.feeAmount ?? null,
              category: normalizeText(args.category) || null,
              serviceType: normalizeText(args.serviceType) || null,
              serviceId: undefined,
            };
          }
          if (target.feeAmount === null) {
            return validationError("Could not resolve the target price. Supply serviceId/agentId of a priced service, or feeAmount explicitly.");
          }
          const services = collectServices(agents, { category: target.category || undefined, serviceType: target.serviceType || undefined });
          const result = competitorSet(services, {
            feeAmount: target.feeAmount,
            category: target.category ?? undefined,
            serviceType: target.serviceType ?? undefined,
            limit: args.limit ?? 10,
            excludeServiceId: target.serviceId,
          });
          return textResult({
            ok: result.finding === null,
            target: { feeAmount: target.feeAmount, category: target.category ?? null, serviceType: target.serviceType ?? null },
            finding: result.finding,
            totalComparables: result.total,
            competitors: result.competitors.map((c) => ({
              serviceId: c.serviceId,
              agentId: c.agentId,
              agentName: c.agentName,
              serviceName: c.serviceName,
              serviceType: c.serviceType,
              feeAmount: c.feeAmount,
              priceDelta: c.priceDelta,
              soldCount: c.soldCount,
              feedbackRate: c.feedbackRate,
              securityRate: c.securityRate,
            })),
            ...ctx,
          });
        },
      );

      // ── PAID 4: price_my_service ─────────────────────────────────────────
      server.registerTool(
        "price_my_service",
        {
          title: "Where a service's price sits in its category",
          description:
            "Where a specific service's listed price sits as a percentile of its category, the nearest competitor above and below, and a defensible band. Costs 0.015 USDT0.",
          inputSchema: {
            agentId: z.string().optional().describe("Agent owning the service."),
            serviceId: z.string().optional().describe("Exact service id."),
            feeAmount: z.number().optional().describe("Explicit listed price to place, if not resolving a service."),
            category: z.string().optional().describe("Category to place within."),
            serviceType: z.string().optional().describe("Service type to place within."),
          },
        },
        async (args) => {
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) return validationError("No snapshot ingested yet.");
          const agents = index.agents();
          const sid = normalizeText(args.serviceId);
          const aid = normalizeText(args.agentId);
          let price: number | null = args.feeAmount ?? null;
          let category: string | null = normalizeText(args.category) || null;
          let serviceType: string | null = normalizeText(args.serviceType) || null;
          if (sid || aid) {
            const agent = agents.find((a) => a.agentId === aid);
            const service = agent?.services.find((s) => s.serviceId === sid || s.id === sid);
            if (service && service.feeAmount !== null && service.feeAmount !== undefined) {
              price = service.feeAmount;
              category = category ?? [agent!.categoryCode, agent!.categoryName].filter(Boolean).join(" ");
              serviceType = serviceType ?? service.type;
            } else if (agent && price === null && agent.serviceMinPrice !== null && agent.serviceMinPrice !== undefined) {
              price = agent.serviceMinPrice;
              category = category ?? [agent.categoryCode, agent.categoryName].filter(Boolean).join(" ");
            }
          }
          if (price === null) {
            return validationError("Could not resolve the target price. Supply serviceId/agentId of a priced service, or feeAmount explicitly.");
          }
          const services = collectServices(agents, { category: category || undefined, serviceType: serviceType || undefined });
          const priced = services.filter((s) => s.feeAmount !== null && s.feeAmount !== undefined && s.serviceId !== sid);
          if (priced.length === 0) {
            return textResult({
              ok: false,
              finding: NO_COMPARABLE_SUPPLY,
              target: { feeAmount: price, category, serviceType },
              ...ctx,
            });
          }
          const p = placement(price, priced);
          const band = priceBand(priced);
          const feeList = priced.map((s) => s.feeAmount as number);
          const d = distribution(feeList);
          return textResult({
            ok: true,
            target: { feeAmount: price, category, serviceType },
            percentile: Math.round(p.percentile * 10) / 10,
            nearestAbove: p.above,
            nearestBelow: p.below,
            defensibleBand: band ? { low: band.low, high: band.high } : null,
            categoryDistribution: { min: d.min, p25: d.p25, median: d.median, p75: d.p75, max: d.max, count: d.count },
            advice:
              p.percentile >= 90
                ? "This price sits at the top of the category — expect buyers to compare it against cheaper comparable services."
                : p.percentile <= 10
                  ? "This price is near the bottom of the category — demand is there, but so is the money left on the table."
                  : "This price sits inside the category's main band.",
            ...ctx,
          });
        },
      );

      // ── PAID 5: quote_advisor ────────────────────────────────────────────
      server.registerTool(
        "quote_advisor",
        {
          title: "Whether a budget is above or below market",
          description:
            "Given a budget a buyer has offered, whether it is above or below market for that category, and what counter-offer the distribution supports. Costs 0.015 USDT0.",
          inputSchema: {
            budget: z.number().describe("The offered amount in USDT0."),
            category: z.string().optional().describe("Category to compare within."),
            query: z.string().optional().describe("Keyword to compare within."),
            serviceType: z.string().optional().describe("Service type to compare within."),
          },
        },
        async ({ budget, category, query, serviceType }) => {
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) return validationError("No snapshot ingested yet.");
          if (typeof budget !== "number" || !Number.isFinite(budget)) {
            return validationError("budget must be a finite number.");
          }
          const services = collectServices(index.agents(), {
            category: normalizeText(category) || undefined,
            query: normalizeText(query) || undefined,
            serviceType: normalizeText(serviceType) || undefined,
          });
          const fees = services.map((s) => s.feeAmount).filter((v): v is number => v !== null && v !== undefined);
          if (fees.length === 0) {
            return textResult({
              ok: false,
              finding: NO_COMPARABLE_SUPPLY,
              budget,
              resolved: { category: category ?? null, query: query ?? null, serviceType: serviceType ?? null },
              ...ctx,
            });
          }
          const d = distribution(fees);
          const band = priceBand(services);
          const verdict =
            budget < d.p25!
              ? "below market"
              : budget > d.p75!
                ? "above market"
                : "at market";
          return textResult({
            ok: true,
            budget,
            verdict,
            market: { min: d.min, p25: d.p25, median: d.median, p75: d.p75, max: d.max, count: d.count },
            counterOffer: band
              ? {
                  supportedRange: [band.low, band.high],
                  note: "The p25–p75 band of listed prices for this set — the range the distribution supports.",
                }
              : null,
            resolved: { category: category ?? null, query: query ?? null, serviceType: serviceType ?? null },
            ...ctx,
          });
        },
      );

      // ── PAID 6: demand_signal ────────────────────────────────────────────
      server.registerTool(
        "demand_signal",
        {
          title: "Supply against sold volume per category",
          description:
            "Per category: how much supply is listed against how much has actually sold. Separates crowded-and-idle from thin-and-moving. Costs 0.02 USDT0.",
          inputSchema: { category: z.string().optional().describe("Focus on one category; omit for all.") },
        },
        async ({ category }) => {
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) return validationError("No snapshot ingested yet.");
          const agents = index.agents();
          const byCategory = new Map<string, { agents: number; services: number; sold: number; pricedServices: number }>();
          for (const a of agents) {
            const key = categoryKey(a);
            if (normalizeText(category) && !key.toLowerCase().includes(normalizeText(category).toLowerCase())) continue;
            const entry = byCategory.get(key) ?? { agents: 0, services: 0, sold: 0, pricedServices: 0 };
            entry.agents++;
            entry.services += a.services.length;
            entry.sold += a.soldCount ?? 0;
            entry.pricedServices += a.services.filter((s) => s.feeAmount !== null && s.feeAmount !== undefined).length;
            byCategory.set(key, entry);
          }
          const rows = [...byCategory.entries()]
            .map(([categoryName, c]) => ({
              category: categoryName,
              ...c,
              soldPerService: c.pricedServices > 0 ? c.sold / c.pricedServices : null,
              signal:
                c.sold === 0
                  ? "crowded-and-idle"
                  : c.pricedServices > 0 && c.sold / c.pricedServices >= 0.1
                    ? "thin-and-moving"
                    : "quiet",
            }))
            .sort((a, b) => (b.soldPerService ?? 0) - (a.soldPerService ?? 0));
          return textResult({
            ok: true,
            basisNote: "soldCount is cumulative per agent across all of its services — a demand signal, not a service-level count.",
            signal: rows.slice(0, 50),
            totalAgents: agents.length,
            ...ctx,
          });
        },
      );

      // ── PAID 7: listing_audit ────────────────────────────────────────────
      server.registerTool(
        "listing_audit",
        {
          title: "Audit every service of one agent",
          description:
            "Audits every service of one agent at once: mispriced against market, no comparable demand, or duplicating each other. Costs 0.02 USDT0.",
          inputSchema: { agentId: z.string().describe("The agent to audit.") },
        },
        async ({ agentId }) => {
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) return validationError("No snapshot ingested yet.");
          const id = normalizeText(agentId);
          if (!id) return validationError("agentId is required.");
          const agents = index.agents();
          const agent = agents.find((a) => a.agentId === id);
          if (!agent) {
            return textResult({ ok: false, finding: `Agent ${id} is not in the current snapshot.`, ...ctx });
          }
          const category = [agent.categoryCode, agent.categoryName].filter(Boolean).join(" ");
          const comparable = collectServices(agents, { category: category || undefined });
          const audit = agent.services.map((svc) => {
            if (svc.feeAmount === null || svc.feeAmount === undefined) {
              return {
                serviceId: svc.serviceId,
                name: svc.name,
                feeAmount: null,
                finding: "no listed price — cannot compare",
              };
            }
            const peers = comparable.filter(
              (s) =>
                s.feeAmount !== null &&
                s.feeAmount !== undefined &&
                s.serviceId !== svc.serviceId &&
                (!svc.type || (s.serviceType ?? "").toLowerCase() === svc.type.toLowerCase()),
            );
            if (peers.length === 0) {
              return {
                serviceId: svc.serviceId,
                name: svc.name,
                feeAmount: svc.feeAmount,
                finding: NO_COMPARABLE_SUPPLY,
              };
            }
            const d = distribution(peers.map((s) => s.feeAmount as number));
            const p = placement(svc.feeAmount, peers);
            const duplicates = agent.services.filter(
              (o) => o.serviceId !== svc.serviceId && o.name && svc.name && o.name.toLowerCase() === svc.name.toLowerCase(),
            );
            const finding =
              p.percentile >= 90
                ? "priced at or above the 90th percentile of comparable listed prices"
                : p.percentile <= 10
                  ? "priced at or below the 10th percentile of comparable listed prices"
                  : "within the main band of comparable listed prices";
            return {
              serviceId: svc.serviceId,
              name: svc.name,
              feeAmount: svc.feeAmount,
              percentile: Math.round(p.percentile * 10) / 10,
              categoryMedian: d.median,
              comparableCount: peers.length,
              duplicatesWith: duplicates.map((o) => o.serviceId),
              finding,
            };
          });
          return textResult({
            ok: true,
            agentId: id,
            category,
            serviceCount: audit.length,
            services: audit,
            ...ctx,
          });
        },
      );

      // ── PAID 8: service_gap ──────────────────────────────────────────────
      server.registerTool(
        "service_gap",
        {
          title: "Categories where demand exists but supply is thin",
          description:
            "Categories and keywords where demand exists (services have sold) but few services are listed. Answers what to build next with numbers instead of intuition. Costs 0.02 USDT0.",
          inputSchema: { minSold: z.number().optional().describe("Minimum cumulative sold count to consider a category demanded (default 3).") },
        },
        async ({ minSold }) => {
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) return validationError("No snapshot ingested yet.");
          const threshold = typeof minSold === "number" && Number.isFinite(minSold) ? minSold : 3;
          const agents = index.agents();
          const byCategory = new Map<string, { agents: number; services: number; sold: number }>();
          for (const a of agents) {
            const key = categoryKey(a);
            const entry = byCategory.get(key) ?? { agents: 0, services: 0, sold: 0 };
            entry.agents++;
            entry.services += a.services.length;
            entry.sold += a.soldCount ?? 0;
            byCategory.set(key, entry);
          }
          const gaps = [...byCategory.entries()]
            .filter(([, c]) => c.sold >= threshold)
            .map(([category, c]) => ({
              category,
              services: c.services,
              agents: c.agents,
              sold: c.sold,
              soldPerService: c.services > 0 ? Math.round((c.sold / c.services) * 100) / 100 : null,
              gap: c.services <= 2 ? "thin supply, real demand" : c.services <= 5 ? "moderate supply" : "supplied",
            }))
            .sort((a, b) => (b.soldPerService ?? 0) - (a.soldPerService ?? 0));
          return textResult({
            ok: true,
            basisNote: "Demand here means cumulative sold count on record — the only demand signal the marketplace exposes.",
            minSold: threshold,
            gaps: gaps.filter((g) => g.gap !== "supplied").slice(0, 30),
            suppliedCategories: gaps.filter((g) => g.gap === "supplied").length,
            ...ctx,
          });
        },
      );

      // ── PAID 9: price_trend ──────────────────────────────────────────────
      server.registerTool(
        "price_trend",
        {
          title: "How a category's prices moved across snapshot history",
          description:
            "How a category's median and spread have moved across Compass's own snapshot history, with the observation window stated. Costs 0.02 USDT0.",
          inputSchema: {
            category: z.string().optional().describe("Category to trend; omit for the whole market."),
            query: z.string().optional().describe("Keyword to trend."),
          },
        },
        async ({ category, query }) => {
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) return validationError("No snapshot ingested yet.");
          const points = pricesPerSweep(index.dbHandle(), normalizeText(category) || null);
          const window = { first: points[0]?.startedAt ?? null, last: points[points.length - 1]?.startedAt ?? null, snapshots: points.length };
          if (points.length < 2) {
            return textResult({
              ok: false,
              finding: `History insufficient — ${points.length} snapshot${points.length === 1 ? "" : "s"} held; price_trend needs at least 2 to observe movement.`,
              observationWindow: window,
              ...ctx,
            });
          }
          const trend = points.map((p) => {
            const d = distribution(p.prices);
            return {
              sweepId: p.sweepId,
              at: p.startedAt,
              count: p.count,
              median: d.median,
              p25: d.p25,
              p75: d.p75,
              min: d.min,
              max: d.max,
            };
          });
          const first = trend[0];
          const last = trend[trend.length - 1];
          const medianDelta = first.median !== null && last.median !== null ? Math.round((last.median - first.median) * 1e6) / 1e6 : null;
          return textResult({
            ok: true,
            observationWindow: window,
            medianDelta,
            movement:
              medianDelta === null
                ? "no measurable median movement"
                : medianDelta > 0
                  ? "median listed price rising across held snapshots"
                  : medianDelta < 0
                    ? "median listed price falling across held snapshots"
                    : "median listed price flat across held snapshots",
            trend,
            ...ctx,
          });
        },
      );

      // ── PAID 10: attest_market_report ────────────────────────────────────
      server.registerTool(
        "attest_market_report",
        {
          title: "EIP-191 signed, 0G-anchored market report",
          description:
            "A market report for a category or keyword, JCS-digested, EIP-191 signed by the fleet signer, anchored to 0G Storage, and stored for later retrieval. A seller can cite it in a negotiation and a buyer can verify it was not fabricated. Costs 0.03 USDT0.",
          inputSchema: {
            query: z.string().optional().describe("Keyword in agent/service text."),
            category: z.string().optional().describe("Category code or name."),
            serviceType: z.string().optional().describe("Service type, e.g. A2MCP."),
          },
        },
        async (args) => {
          const ctx = snapshotCtx(index);
          if (!ctx.snapshotAt) return validationError("No snapshot ingested yet.");
          const services = collectServices(index.agents(), {
            query: normalizeText(args.query) || undefined,
            category: normalizeText(args.category) || undefined,
            serviceType: normalizeText(args.serviceType) || undefined,
          });
          const fees = services.map((s) => s.feeAmount).filter((v): v is number => v !== null && v !== undefined);
          const d = distribution(fees);
          const rows = services.slice(0, 100).map((s) => ({
            agentId: s.agentId,
            serviceId: s.serviceId,
            serviceName: s.serviceName,
            feeAmount: s.feeAmount,
            soldCount: s.soldCount,
            feedbackRate: s.feedbackRate,
          }));
          const payload = {
            query: normalizeText(args.query) || normalizeText(args.category) || "market",
            basis: ctx.basis,
            snapshotAt: ctx.snapshotAt!,
            coverage: ctx.coverage,
            sampleSize: fees.length,
            stats: d,
            rows,
          };
          const digest = reportDigest(payload);
          const signer = requireSigner();
          const { signature } = await signDigest(digest, signer.privateKey);
          const anchored = await anchorToOgStorage({ digest, report: payload, signature, signer: signer.address, anchoredAt: new Date().toISOString() });
          const artifact = {
            digest,
            report: payload,
            signature,
            signer: signer.address,
            anchorRoot: anchored.ok ? (anchored.root ?? null) : null,
            anchorTx: anchored.ok ? (anchored.tx ?? null) : null,
          };
          saveArtifact(index.dbHandle(), artifact);
          return textResult({
            ok: true,
            digest,
            signature,
            signer: signer.address,
            canonicalDigestInputs: canonicalPayload(payload),
            anchor: anchored.ok
              ? { status: "anchored", root: anchored.root, tx: anchored.tx }
              : { status: "anchoring-failed", error: anchored.error },
            report: payload,
            artifactDigest: digest,
            ...ctx,
          });
        },
      );
    },
    { instructions: INSTRUCTIONS }
  );

  return handler;
}
