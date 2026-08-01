import { describe, expect, it } from "vitest";
import { cleanPrices, distribution, mean, percentile, ratingBands, spread } from "../lib/compass/stats.js";

describe("cleanPrices", () => {
  it("drops null, NaN and negative values and sorts ascending", () => {
    expect(cleanPrices([3, 1, NaN, 2, -5, Infinity])).toEqual([1, 2, 3]);
  });
});

describe("percentile", () => {
  it("returns the only value for n=1", () => {
    expect(percentile([0.05], 50)).toBe(0.05);
    expect(percentile([0.05], 25)).toBe(0.05);
  });

  it("interpolates between two values for n=2", () => {
    expect(percentile([0.01, 0.05], 50)).toBeCloseTo(0.03);
    expect(percentile([0.01, 0.05], 0)).toBe(0.01);
    expect(percentile([0.01, 0.05], 100)).toBe(0.05);
  });

  it("returns the same value for all-equal inputs", () => {
    expect(percentile([0.02, 0.02, 0.02, 0.02], 25)).toBe(0.02);
    expect(percentile([0.02, 0.02, 0.02, 0.02], 75)).toBe(0.02);
  });

  it("computes standard quartiles", () => {
    const v = [0.005, 0.01, 0.02, 0.05, 0.1];
    expect(percentile(v, 25)).toBe(0.01);
    expect(percentile(v, 50)).toBe(0.02);
    expect(percentile(v, 75)).toBe(0.05);
  });

  it("is null for an empty set", () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe("distribution", () => {
  it("returns empty for no values", () => {
    expect(distribution([])).toEqual({ min: null, p25: null, median: null, p75: null, max: null, count: 0 });
  });

  it("collapses n=1 to the value everywhere", () => {
    const d = distribution([0.05]);
    expect(d).toEqual({ min: 0.05, p25: 0.05, median: 0.05, p75: 0.05, max: 0.05, count: 1 });
  });

  it("n=2 median is the midpoint", () => {
    const d = distribution([0.01, 0.05]);
    expect(d.median).toBeCloseTo(0.03);
    expect(d.min).toBe(0.01);
    expect(d.max).toBe(0.05);
  });

  it("all-equal values produce the same value", () => {
    const d = distribution([0.02, 0.02, 0.02]);
    expect(d.median).toBe(0.02);
    expect(d.p25).toBe(0.02);
    expect(d.p75).toBe(0.02);
  });

  it("matches the reference distribution", () => {
    const d = distribution([0.005, 0.01, 0.02, 0.05, 0.1]);
    expect(d).toEqual({ min: 0.005, p25: 0.01, median: 0.02, p75: 0.05, max: 0.1, count: 5 });
  });
});

describe("mean", () => {
  it("computes the mean and null for empty", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNull();
  });
});

describe("spread", () => {
  it("returns range and null for empty", () => {
    expect(spread([0.01, 0.05])).toEqual({ min: 0.01, max: 0.05, range: 0.04 });
    expect(spread([])).toBeNull();
  });
});

describe("ratingBands", () => {
  it("returns four price quartiles with rating spread", () => {
    const prices = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08];
    const ratings = [100, 90, 80, 70, 60, 50, 40, 30];
    const bands = ratingBands(prices, ratings);
    expect(bands).toHaveLength(4);
    expect(bands[0].band).toBe("low");
    expect(bands[0].priceRange).toEqual([0.01, 0.02]);
    expect(bands[0].meanRating).toBe(95);
    expect(bands[3].band).toBe("high");
    expect(bands[3].meanRating).toBe(35);
  });

  it("handles a single member", () => {
    const bands = ratingBands([0.05], [100]);
    expect(bands).toHaveLength(1);
    expect(bands[0].meanRating).toBe(100);
  });

  it("skips non-finite ratings without dropping the band", () => {
    const bands = ratingBands([0.01, 0.02, 0.03, 0.04], [100, NaN, 80, 70]);
    expect(bands[0].meanRating).toBe(100);
    expect(bands[1].meanRating).toBeNull();
  });

  it("returns empty for no prices", () => {
    expect(ratingBands([], [])).toEqual([]);
  });
});
