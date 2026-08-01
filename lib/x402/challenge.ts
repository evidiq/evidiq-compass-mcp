import { X402Challenge, X402AcceptRequirement } from "./types.js";
import { getX402Config } from "./config.js";

export const TOOL_PRICES_ATOMIC: Record<string, string> = {
  counterparty_history: "5000",
  market_rate: "10000",
  competitor_set: "10000",
  price_my_service: "15000",
  quote_advisor: "15000",
  demand_signal: "20000",
  listing_audit: "20000",
  service_gap: "20000",
  price_trend: "20000",
  attest_market_report: "30000",
};

export const TOOL_PRICES_HUMAN: Record<string, string> = {
  counterparty_history: "0.005 USDT0",
  market_rate: "0.01 USDT0",
  competitor_set: "0.01 USDT0",
  price_my_service: "0.015 USDT0",
  quote_advisor: "0.015 USDT0",
  demand_signal: "0.02 USDT0",
  listing_audit: "0.02 USDT0",
  service_gap: "0.02 USDT0",
  price_trend: "0.02 USDT0",
  attest_market_report: "0.03 USDT0",
};

export const FREE_TOOL_NAMES: string[] = [
  "compass_capabilities",
  "estimate_cost",
  "validate_query",
  "category_map",
  "snapshot_status",
  "whoami_listing",
  "verify_compass_report",
  "get_artifact",
];

export function createChallenge(toolName: string): X402Challenge {
  const cfg = getX402Config();
  const atomicAmount = TOOL_PRICES_ATOMIC[toolName] || "5000";
  const humanAmount = TOOL_PRICES_HUMAN[toolName] || "0.005 USDT0";

  const acceptReq: X402AcceptRequirement = {
    scheme: "exact",
    network: cfg.chain,
    asset: cfg.asset,
    amount: atomicAmount,
    payTo: cfg.payTo,
    maxTimeoutSeconds: 300,
    extra: {
      name: cfg.domainName,
      version: cfg.domainVersion,
    },
  };

  return {
    x402Version: 2,
    resource: {
      url: `${cfg.publicBaseUrl}/mcp`,
      description:
        "EVIDIQ Compass — pricing and demand intelligence for the OKX.AI agent market: where a price sits against comparable services, which categories have demand, who you are about to transact with, and how any of it has moved since yesterday.",
      mimeType: "application/json",
    },
    accepts: [acceptReq],
    error: `Payment Required for tool '${toolName}'. Costs ${humanAmount}.`,
  };
}

export function encodeChallengeToBase64(challenge: X402Challenge): string {
  const { error, ...headerChallenge } = challenge;
  return Buffer.from(JSON.stringify(headerChallenge)).toString("base64");
}

export function getX402DiscoveryCatalog() {
  const cfg = getX402Config();
  const paid = Object.entries(TOOL_PRICES_ATOMIC).map(([tool, amount]) => ({
    tool,
    amount,
    usd: Number(TOOL_PRICES_HUMAN[tool].split(" ")[0]),
  }));
  const free = FREE_TOOL_NAMES.map((tool) => ({ tool, amount: "0", usd: 0, free: true }));
  return {
    x402Version: 2,
    resource: {
      url: `${cfg.publicBaseUrl}/mcp`,
      description:
        "EVIDIQ Compass — pricing and demand intelligence for the OKX.AI agent market. 8 free tools (compass_capabilities, estimate_cost, validate_query, category_map, snapshot_status, whoami_listing, verify_compass_report, get_artifact) remain free.",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: cfg.chain,
        asset: cfg.asset,
        amount: "5000",
        payTo: cfg.payTo,
        maxTimeoutSeconds: 300,
        extra: {
          name: cfg.domainName,
          version: cfg.domainVersion,
        },
      },
    ],
    pricing: [...paid, ...free],
    guidance:
      "Compass reads, ranks and explains the market; it never writes to it. Counts and categories are free; prices are not.",
  };
}
