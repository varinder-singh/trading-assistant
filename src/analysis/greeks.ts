export interface OptionGreeks {
  iv: number
  delta: number
  gamma: number
  theta: number
  vega: number
}

// Standard Normal cumulative distribution function
function cdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp((-x * x) / 2)
  const prob =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - prob : prob
}

// Standard Normal probability density function
function pdf(x: number): number {
  return (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x)
}

/**
 * Calculate Black-Scholes Option Price
 */
export function calculateBSPrice(
  S: number, // Underlying Price
  K: number, // Strike Price
  T: number, // Time to Expiry (in years)
  r: number, // Risk-Free Rate
  v: number, // Implied Volatility (decimal)
  type: "CE" | "PE"
): number {
  if (T <= 0) return Math.max(0, type === "CE" ? S - K : K - S)

  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T))
  const d2 = d1 - v * Math.sqrt(T)

  if (type === "CE") {
    return S * cdf(d1) - K * Math.exp(-r * T) * cdf(d2)
  } else {
    return K * Math.exp(-r * T) * cdf(-d2) - S * cdf(-d1)
  }
}

/**
 * Calculate Implied Volatility using Newton-Raphson method
 */
export function calculateIV(
  targetPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: "CE" | "PE"
): number {
  if (T <= 0) return 0 // Cannot compute IV at expiry
  
  // Intrinsic value check
  const intrinsic = Math.max(0, type === "CE" ? S - K : K - S)
  if (targetPrice <= intrinsic) return 0.01 // Option trading at or below intrinsic, IV is near zero

  let v = 0.3 // Initial guess 30%
  const MAX_ITERATIONS = 100
  const TOLERANCE = 0.001

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const price = calculateBSPrice(S, K, T, r, v, type)
    const diff = price - targetPrice

    if (Math.abs(diff) < TOLERANCE) {
      return v
    }

    const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T))
    const vega = S * Math.sqrt(T) * pdf(d1) // Vega is same for Call and Put

    if (vega === 0) break // Derivative is 0, cannot proceed

    v = v - diff / vega

    // Bound v to avoid negative or extreme IVs
    if (v < 0.001) v = 0.001
    if (v > 5.0) v = 5.0
  }

  return v
}

/**
 * Calculate all Option Greeks
 */
export function calculateGreeks(
  S: number,
  K: number,
  T: number, // years
  r: number,
  v: number, // implied volatility
  type: "CE" | "PE"
): OptionGreeks {
  if (T <= 0 || v <= 0) {
    return {
      iv: v,
      delta: type === "CE" ? (S >= K ? 1 : 0) : (S <= K ? -1 : 0),
      gamma: 0,
      theta: 0,
      vega: 0,
    }
  }

  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T))
  const d2 = d1 - v * Math.sqrt(T)

  // Delta
  const delta = type === "CE" ? cdf(d1) : cdf(d1) - 1

  // Gamma (Same for Call/Put)
  const gamma = pdf(d1) / (S * v * Math.sqrt(T))

  // Vega (Same for Call/Put) - Usually divided by 100 to show change per 1% change in IV
  const vega = (S * pdf(d1) * Math.sqrt(T)) / 100

  // Theta - Usually divided by 365 to show daily decay
  let theta = 0
  const term1 = (-S * pdf(d1) * v) / (2 * Math.sqrt(T))
  if (type === "CE") {
    const term2 = r * K * Math.exp(-r * T) * cdf(d2)
    theta = (term1 - term2) / 365
  } else {
    const term2 = r * K * Math.exp(-r * T) * cdf(-d2)
    theta = (term1 + term2) / 365
  }

  return { iv: v, delta, gamma, theta, vega }
}

/**
 * Helper to compute Greeks directly from the market price
 */
export function getGreeksFromPrice(
  targetPrice: number,
  S: number,
  K: number,
  daysToExpiry: number,
  r: number = 0.07, // 7% risk-free rate for India
  type: "CE" | "PE"
): OptionGreeks {
  const T = Math.max(0.001, daysToExpiry / 365) // Avoid div by 0 for same-day expiry
  const iv = calculateIV(targetPrice, S, K, T, r, type)
  return calculateGreeks(S, K, T, r, iv, type)
}
