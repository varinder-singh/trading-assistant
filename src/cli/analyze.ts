import { Command } from "commander"
import { runAnalysis } from "../analysis/trade.js"
import kc from "../data/kite.js"

export const analyzeCommand = new Command("analyze")
  .argument("<symbol>", "Symbol like NIFTY")
  .option("-m, --mode <mode>", "intraday | swing", "intraday")
  .action(async (symbol, options) => {
    await runAnalysis(kc, symbol, options.mode)
  })
