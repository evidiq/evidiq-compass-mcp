import { describe, expect, it } from "vitest";
import {
  canonicalPayload,
  getSignerKey,
  reportDigest,
  requireSigner,
  signDigest,
  verifySignature,
} from "../lib/compass/report.js";

const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil #0 - throwaway, test-only

const payload = {
  query: "security",
  basis: "listed_price",
  snapshotAt: "2026-08-02T00:15:00.000Z",
  coverage: 1,
  sampleSize: 1217,
  stats: { min: 0.005, median: 0.02, max: 0.05 },
  rows: [{ agentId: "1", feeAmount: 0.02 }],
};

describe("reportDigest", () => {
  it("is deterministic over the closed field set", () => {
    const a = reportDigest(payload);
    const b = reportDigest({ ...payload });
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("ignores property order via JCS canonicalisation", () => {
    const reordered = {
      rows: payload.rows,
      stats: payload.stats,
      sampleSize: payload.sampleSize,
      coverage: payload.coverage,
      snapshotAt: payload.snapshotAt,
      basis: payload.basis,
      query: payload.query,
    };
    expect(reportDigest(reordered)).toBe(reportDigest(payload));
  });

  it("changes when a payload field changes", () => {
    expect(reportDigest({ ...payload, coverage: 0.8 })).not.toBe(reportDigest(payload));
  });

  it("canonical payload contains only the closed fields", () => {
    const withExtra = { ...payload, sneaky: "extra" };
    const canonical = canonicalPayload(withExtra);
    expect(canonical).toContain('"query"');
    expect(canonical).not.toContain("sneaky");
  });
});

describe("signer", () => {
  it("requires COMPASS_SIGNER_PRIVATE_KEY and throws without it", () => {
    expect(getSignerKey({})).toBeNull();
    expect(getSignerKey({ COMPASS_SIGNER_PRIVATE_KEY: "not-hex" })).toBeNull();
    expect(() => requireSigner({})).toThrow(/COMPASS_SIGNER_PRIVATE_KEY/);
  });

  it("signs and verifies an EIP-191 digest", async () => {
    const digest = reportDigest(payload);
    const { signature, signer } = await signDigest(digest, TEST_KEY);
    expect(signer).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(await verifySignature(digest, signature, signer)).toBe(true);
    expect(await verifySignature(reportDigest({ ...payload, query: "api" }), signature, signer)).toBe(false);
  });
});
