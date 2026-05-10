import axios from "axios"

export async function getNews(symbol: string): Promise<string[]> {
  const apiKey = process.env.NEWS_API_KEY

  const queryMap: Record<string, string> = {
    NIFTY: "NIFTY 50 India stock market",
    BANKNIFTY: "Banking stocks India RBI",
    HDFCBANK: "HDFC Bank news",
  }

  const query = queryMap[symbol.toUpperCase()] || symbol

  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&pageSize=5&apiKey=${apiKey}`

  const res = await axios.get(url)

  return res.data.articles.map((a: any) => a.title)
}
