import axios from "axios"

export async function getOptionChain(index: "NIFTY" | "BANKNIFTY") {
  const url =
    index === "NIFTY"
      ? "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY"
      : "https://www.nseindia.com/api/option-chain-indices?symbol=BANKNIFTY"

  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    },
  })

  console.log("Fetched option chain data for", index)
  return res.data
}
