export function calculatePCR(data: any) {
  const records = data?.records?.data ?? []

  const { totalCE, totalPE } = records.reduce(
    (acc: { totalCE: number; totalPE: number }, item: any) => {
      if (item.CE && item.PE) {
        return {
          totalCE: acc.totalCE + (item.CE.openInterest || 0),
          totalPE: acc.totalPE + (item.PE.openInterest || 0),
        }
      }
      return acc
    },
    { totalCE: 0, totalPE: 0 }
  )

  const pcr = totalCE > 0 ? totalPE / totalCE : 0

  return {
    pcr: Number(pcr.toFixed(2)),
    sentiment: pcr > 1.2 ? 'bullish' : pcr < 0.8 ? 'bearish' : 'neutral',
  }
}

export function findOIZones(data: any) {
  const records = data?.records?.data ?? []

  const result = records.reduce(
    (acc: { maxCallOI: number; maxPutOI: number; resistance: number; support: number }, item: any) => {
      const callOI = item.CE?.openInterest ?? 0
      const putOI = item.PE?.openInterest ?? 0

      const nextMaxCall = callOI > acc.maxCallOI ? callOI : acc.maxCallOI
      const nextResistance = callOI > acc.maxCallOI ? item.strikePrice : acc.resistance

      const nextMaxPut = putOI > acc.maxPutOI ? putOI : acc.maxPutOI
      const nextSupport = putOI > acc.maxPutOI ? item.strikePrice : acc.support

      return {
        maxCallOI: nextMaxCall,
        maxPutOI: nextMaxPut,
        resistance: nextResistance,
        support: nextSupport,
      }
    },
    { maxCallOI: 0, maxPutOI: 0, resistance: 0, support: 0 }
  )

  return {
    resistance: result.resistance,
    support: result.support,
  }
}
