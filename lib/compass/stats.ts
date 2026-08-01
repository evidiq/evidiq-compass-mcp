export interface Distribution {
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  count: number;
}

export function cleanPrices(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
}

export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedAsc[lower];
  const weight = rank - lower;
  return sortedAsc[lower] * (1 - weight) + sortedAsc[upper] * weight;
}

export function distribution(values: number[]): Distribution {
  const prices = cleanPrices(values);
  if (prices.length === 0) {
    return { min: null, p25: null, median: null, p75: null, max: null, count: 0 };
  }
  return {
    min: prices[0],
    p25: percentile(prices, 25),
    median: percentile(prices, 50),
    p75: percentile(prices, 75),
    max: prices[prices.length - 1],
    count: prices.length,
  };
}

export function mean(values: number[]): number | null {
  const prices = cleanPrices(values);
  if (prices.length === 0) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

export interface RatingBand {
  band: "low" | "mid-low" | "mid-high" | "high";
  priceRange: [number, number];
  services: number;
  meanRating: number | null;
  minRating: number | null;
  maxRating: number | null;
}

export function ratingBands(prices: number[], ratings: number[]): RatingBand[] {
  const n = prices.length;
  if (n === 0) return [];
  const sortedIdx = prices
    .map((_, i) => i)
    .sort((a, b) => prices[a] - prices[b]);
  const names = ["low", "mid-low", "mid-high", "high"] as const;
  const bands: RatingBand[] = [];
  let prevEnd = 0;
  for (let b = 0; b < 4; b++) {
    const start = Math.floor((n * b) / 4);
    const end = Math.max(start + 1, Math.floor((n * (b + 1)) / 4));
    if (start < prevEnd) continue;
    prevEnd = end;
    const members = sortedIdx.slice(start, end);
    if (members.length === 0) continue;
    const r = members.map((i) => ratings[i]).filter((v) => Number.isFinite(v));
    bands.push({
      band: names[b],
      priceRange: [prices[members[0]], prices[members[members.length - 1]]],
      services: members.length,
      meanRating: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null,
      minRating: r.length ? Math.min(...r) : null,
      maxRating: r.length ? Math.max(...r) : null,
    });
  }
  return bands;
}

export function spread(values: number[]): { min: number; max: number; range: number } | null {
  const prices = cleanPrices(values);
  if (prices.length === 0) return null;
  return { min: prices[0], max: prices[prices.length - 1], range: prices[prices.length - 1] - prices[0] };
}
