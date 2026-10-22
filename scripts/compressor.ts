// scripts/compressor.ts
export interface CompactOptionRow {
  k: number // Strike Price
  ce: {
    p: number // LTP
    oi: number // Open Interest
    coi: number // Change in OI
    d: number // Delta
    b: string // Buildup: 'LB' (Long Buildup), 'SC' (Short Covering), 'SB', 'LU'
  }
  pe: {
    p: number
    oi: number
    coi: number
    d: number
    b: string
  }
}

export interface CompressedOptionsPayload {
  underlying: string
  spot: number
  atmStrike: number
  pcr: number
  pcrAtm: number
  maxPain: number
  ivRank?: number
  atmIv: number
  sentiment: string
  strikes: CompactOptionRow[] // Exactly 5 strikes: ATM-2 to ATM+2
  recommended: {
    ceStrike: number
    ceGammaRatio: number
    peStrike: number
    peGammaRatio: number
  }
}

export class OptionsPayloadCompressor {
  private static encodeBuildup(buildup?: string): string {
    if (!buildup) return '-'
    if (buildup.includes('Long Buildup')) return 'LB'
    if (buildup.includes('Short Covering')) return 'SC'
    if (buildup.includes('Short Buildup')) return 'SB'
    if (buildup.includes('Long Unwinding')) return 'LU'
    return buildup.slice(0, 2).toUpperCase()
  }

  public static compress(rawAnalysis: any, symbol: string, spotPrice: number): CompressedOptionsPayload {
    const atmStrike = rawAnalysis.atmStrike || spotPrice
    const allRows: any[] = rawAnalysis.rows || []

    // 1. DOWNSAMPLE: Extract unique strikes and sort
    const uniqueStrikes = [...new Set(allRows.map((r: any) => r.strike))].sort((a: number, b: number) => a - b)
    const atmIdx = uniqueStrikes.findIndex((k) => k === atmStrike)
    const targetIdx = atmIdx >= 0 ? atmIdx : Math.floor(uniqueStrikes.length / 2)

    // Slice exactly ATM - 2 to ATM + 2 (5 strikes)
    const start = Math.max(0, targetIdx - 2)
    const end = Math.min(uniqueStrikes.length, start + 5)
    const selectedStrikes = uniqueStrikes.slice(start, end)

    // 2. COMPRESS & STRIP: Map into compact unified rows
    const compactStrikes: CompactOptionRow[] = selectedStrikes.map((k) => {
      const ce = allRows.find((r: any) => r.strike === k && r.type === 'CE')
      const pe = allRows.find((r: any) => r.strike === k && r.type === 'PE')

      return {
        k,
        ce: {
          p: ce?.ltp || 0,
          oi: ce?.oi || 0,
          coi: ce?.changeOi || 0,
          d: Number((ce?.greeks?.delta || 0).toFixed(2)),
          b: this.encodeBuildup(ce?.buildup),
        },
        pe: {
          p: pe?.ltp || 0,
          oi: pe?.oi || 0,
          coi: pe?.changeOi || 0,
          d: Number((pe?.greeks?.delta || 0).toFixed(2)),
          b: this.encodeBuildup(pe?.buildup),
        },
      }
    })

    // Extract ATM IV
    const atmCe = allRows.find((r: any) => r.strike === atmStrike && r.type === 'CE')
    const atmIv = Number(((atmCe?.greeks?.iv || 0.15) * 100).toFixed(1))

    return {
      underlying: symbol,
      spot: spotPrice,
      atmStrike,
      pcr: Number((rawAnalysis.pcr || 1.0).toFixed(2)),
      pcrAtm: Number((rawAnalysis.pcrAtm || 1.0).toFixed(2)),
      maxPain: rawAnalysis.maxPain || atmStrike,
      ivRank: rawAnalysis.ivRank,
      atmIv,
      sentiment: rawAnalysis.sentiment || 'neutral',
      strikes: compactStrikes,
      recommended: {
        ceStrike: rawAnalysis.recommendedCE?.strike || atmStrike,
        ceGammaRatio: Number((rawAnalysis.recommendedCE?.gammaToPriceRatio || 0).toFixed(2)),
        peStrike: rawAnalysis.recommendedPE?.strike || atmStrike,
        peGammaRatio: Number((rawAnalysis.recommendedPE?.gammaToPriceRatio || 0).toFixed(2)),
      },
    }
  }
}
