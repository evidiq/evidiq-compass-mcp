import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  coverageOf,
  MarketplaceAgent,
  runSweep,
  sweepQuery,
  writeSnapshot,
} from "../lib/compass/collect.js";

function makeAgent(id: string): MarketplaceAgent {
  return {
    agentId: id,
    name: `Agent ${id}`,
    categoryCode: ["SOFTWARE_SERVICES"],
    categoryName: ["Software services"],
    serviceMinPrice: 0.01,
    soldCount: 1,
    buyerCount: 1,
    feedbackRate: 100,
    securityRate: 5,
    onlineStatus: 1,
    totalServiceCount: 1,
    communicationAddress: null,
    chainIndex: 196,
    lowestFeeContractAddress: null,
    services: [],
  };
}

function fakeMarket(total: number, pageSize: number, failPages: Set<number> = new Set()) {
  const agents = Array.from({ length: total }, (_, i) => makeAgent(String(i)));
  const calls: Array<{ query: string; page: number }> = [];
  const fn = async (query: string, page: number, size: number) => {
    calls.push({ query, page });
    if (failPages.has(page)) throw new Error(`boom page ${page}`);
    const start = (page - 1) * size;
    return { total, list: agents.slice(start, start + size) };
  };
  return { fn, calls };
}

const baseOpts = {
  maxPages: 20,
  maxRetries: 2,
  retryBaseMs: 1,
};

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs) {
    try {
      const files = await readdir(d);
      for (const f of files) await Promise.resolve();
    } catch {
      /* ignore */
    }
  }
  dirs.length = 0;
});

async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "compass-test-"));
  dirs.push(d);
  return d;
}

describe("coverageOf", () => {
  it("is stored/total capped at 1", () => {
    expect(coverageOf(99, 99)).toBe(1);
    expect(coverageOf(200, 250)).toBe(0.8);
    expect(coverageOf(99, 10)).toBe(1);
  });
  it("is null when total is missing or zero", () => {
    expect(coverageOf(0, null)).toBeNull();
    expect(coverageOf(0, 0)).toBeNull();
    expect(coverageOf(5, 0)).toBeNull();
  });
});

describe("sweepQuery pagination", () => {
  it("exhausts a single page fully", async () => {
    const { fn, calls } = fakeMarket(99, 100);
    const run = await sweepQuery(fn, "security", 100, baseOpts);
    expect(run.stored).toBe(99);
    expect(run.coverage).toBe(1);
    expect(run.truncated).toBe(false);
    expect(run.pagesFetched).toBe(1);
    expect(calls).toEqual([{ query: "security", page: 1 }]);
  });

  it("paginates to exhaustion across pages", async () => {
    const { fn, calls } = fakeMarket(250, 100);
    const run = await sweepQuery(fn, "api", 100, baseOpts);
    expect(run.stored).toBe(250);
    expect(run.coverage).toBe(1);
    expect(run.truncated).toBe(false);
    expect(run.pagesFetched).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it("stops on an empty page at the end of the result set", async () => {
    const { fn } = fakeMarket(99, 50);
    const run = await sweepQuery(fn, "security", 50, baseOpts);
    expect(run.stored).toBe(99);
    expect(run.coverage).toBe(1);
    expect(run.pagesFetched).toBe(2);
    expect(run.truncated).toBe(false);
  });

  it("marks truncated when the page cap cuts the result short", async () => {
    const { fn, calls } = fakeMarket(250, 100);
    const run = await sweepQuery(fn, "api", 100, { ...baseOpts, maxPages: 2 });
    expect(run.stored).toBe(200);
    expect(run.coverage).toBe(0.8);
    expect(run.truncated).toBe(true);
    expect(run.error).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("marks truncated when the first page is empty but total says otherwise", async () => {
    const market = { total: 5, list: [] as MarketplaceAgent[] };
    const run = await sweepQuery(async () => market, "ghost", 100, baseOpts);
    expect(run.stored).toBe(0);
    expect(run.coverage).toBe(0);
    expect(run.truncated).toBe(true);
  });

  it("reports null coverage when the API reports no total", async () => {
    const market = { total: null as number | null, list: [makeAgent("1")] };
    const run = await sweepQuery(async () => market, "x", 100, baseOpts);
    expect(run.stored).toBe(1);
    expect(run.coverage).toBeNull();
    expect(run.truncated).toBe(true);
  });

  it("retries on error and records it if it never succeeds", async () => {
    const { fn, calls } = fakeMarket(99, 100, new Set([1]));
    const run = await sweepQuery(fn, "security", 100, { ...baseOpts, retryBaseMs: 1 });
    expect(run.error).toBe("boom page 1");
    expect(run.stored).toBe(0);
    expect(run.coverage).toBeNull();
    expect(run.truncated).toBe(true);
    expect(calls.length).toBe(3);
  });

  it("recovers after a transient failure", async () => {
    const agents = Array.from({ length: 250 }, (_, i) => makeAgent(String(i)));
    let failOnce = true;
    const fn = async (_q: string, page: number, size: number) => {
      if (page === 2 && failOnce) {
        failOnce = false;
        throw new Error("boom");
      }
      const start = (page - 1) * size;
      return { total: 250, list: agents.slice(start, start + size) };
    };
    const run = await sweepQuery(fn, "api", 100, { ...baseOpts, retryBaseMs: 1 });
    expect(run.error).toBeNull();
    expect(run.stored).toBe(250);
    expect(run.coverage).toBe(1);
  });

  it("respects the delay between pages", async () => {
    const { fn } = fakeMarket(250, 100);
    const t0 = Date.now();
    await sweepQuery(fn, "api", 100, { ...baseOpts, delayMs: 30 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(60);
  });
});

describe("runSweep", () => {
  it("deduplicates agents across queries", async () => {
    const { fn } = fakeMarket(3, 100);
    const snap = await runSweep(fn, ["a", "b"], 100, { maxPages: 1 });
    expect(snap.agents).toHaveLength(3);
    expect(snap.queries).toHaveLength(2);
    for (const q of snap.queries) {
      expect(q.coverage).toBe(1);
    }
  });

  it("marks skipped queries when the call cap is reached", async () => {
    const { fn } = fakeMarket(50, 100);
    const snap = await runSweep(fn, ["a", "b"], 100, { maxPages: 1, maxCalls: 1 });
    expect(snap.queries[0].error).toBeNull();
    expect(snap.queries[1]).toMatchObject({
      error: "skipped: sweep cap reached",
      truncated: true,
      coverage: null,
    });
  });

  it("records start and finish timestamps", async () => {
    const { fn } = fakeMarket(1, 100);
    const now = () => new Date("2026-08-02T00:00:00.000Z");
    const snap = await runSweep(fn, ["a"], 100, { now, maxPages: 1 });
    expect(snap.startedAt).toBe("2026-08-02T00:00:00.000Z");
    expect(snap.finishedAt).toBe("2026-08-02T00:00:00.000Z");
  });
});

describe("writeSnapshot", () => {
  it("writes append-only snapshot files", async () => {
    const dir = await makeDir();
    const { fn } = fakeMarket(1, 100);
    const a = await runSweep(fn, ["a"], 100, { maxPages: 1 });
    const b = await runSweep(fn, ["a"], 100, { maxPages: 1 });
    const pa = await writeSnapshot(dir, a);
    const pb = await writeSnapshot(dir, b);
    expect(pa).not.toBe(pb);
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    const stored = JSON.parse(await readFile(pa, "utf8"));
    expect(stored.sweepId).toBe(a.sweepId);
    expect(stored.basis).toBe("listed_price");
  });
});
