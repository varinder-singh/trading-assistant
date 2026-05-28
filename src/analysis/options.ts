export function calculatePCR(data: any) {
  const records = data.records.data

  let totalCE = 0
  let totalPE = 0

  for (const item of records) {
    if (item.CE && item.PE) {
      totalCE += item.CE.openInterest || 0
      totalPE += item.PE.openInterest || 0
    }
  }

  const pcr = totalPE / totalCE

  return {
    pcr: Number(pcr.toFixed(2)),
    sentiment: pcr > 1.2 ? "bullish" : pcr < 0.8 ? "bearish" : "neutral",
  }
}

export function findOIZones(data: any) {
  const records = data.records.data

  let maxCallOI = 0
  let maxPutOI = 0

  let callResistance = 0
  let putSupport = 0

  for (const item of records) {
    if (item.CE?.openInterest > maxCallOI) {
      maxCallOI = item.CE.openInterest
      callResistance = item.strikePrice
    }

    if (item.PE?.openInterest > maxPutOI) {
      maxPutOI = item.PE.openInterest
      putSupport = item.strikePrice
    }
  }

  return {
    resistance: callResistance,
    support: putSupport,
  }
}
