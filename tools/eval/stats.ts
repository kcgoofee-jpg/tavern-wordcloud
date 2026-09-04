/**
 * Paired comparison of two tokenizers on the same sentences: McNemar's test,
 * which uses only the discordant items.
 */

export interface Paired {
  /** A right, B wrong */
  b: number;
  /** A wrong, B right */
  c: number;
  /** Both right */
  both: number;
  /** Both wrong */
  neither: number;
}

/** Upper-tail normal probability, Abramowitz & Stegun 26.2.17, error < 7.5e-8. */
function normalSf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? p : 1 - p;
}

/** Binomial P(X <= k) for n trials with p = 0.5; exact test for small samples. */
function binomCdfHalf(k: number, n: number): number {
  if (n === 0) return 1;
  let logC = 0;
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logC += Math.log((n - i + 1) / i);
    sum += Math.exp(logC - n * Math.LN2);
  }
  return Math.min(1, sum);
}

export interface McNemarResult {
  b: number;
  c: number;
  n: number;
  statistic: number | null;
  p: number;
  /** Whether the exact test or the normal approximation was used */
  method: 'exact' | 'chi2-corrected';
  significant: boolean;
  /** Effect size: odds ratio, > 1 favours B */
  oddsRatio: number | null;
}

/**
 * Two-sided McNemar test.
 *
 * @param b A right, B wrong
 * @param c A wrong, B right
 * @param alpha significance level, default 0.05
 *
 * Exact binomial test when fewer than 25 discordant items.
 */
export function mcnemar(b: number, c: number, alpha = 0.05): McNemarResult {
  const n = b + c;
  if (n === 0) {
    return { b, c, n, statistic: null, p: 1, method: 'exact', significant: false, oddsRatio: null };
  }
  const oddsRatio = b === 0 ? Infinity : c / b;

  if (n < 25) {
    // Exact test: under H0 each discordant item is equally likely to favour either side
    const k = Math.min(b, c);
    const p = Math.min(1, 2 * binomCdfHalf(k, n));
    return { b, c, n, statistic: null, p, method: 'exact', significant: p < alpha, oddsRatio };
  }
  // Chi-square with continuity correction
  const chi2 = ((Math.abs(b - c) - 1) ** 2) / n;
  const p = 2 * normalSf(Math.sqrt(chi2));
  return { b, c, n, statistic: chi2, p: Math.min(1, p), method: 'chi2-corrected', significant: p < alpha, oddsRatio };
}

/** Wilson interval: reliable for small samples and stays within [0,1]. */
export function wilson(successes: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 0];
  const p = successes / total;
  const d = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const half = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return [Math.max(0, (centre - half) / d), Math.min(1, (centre + half) / d)];
}
