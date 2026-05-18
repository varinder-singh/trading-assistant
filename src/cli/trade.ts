import "dotenv/config"
import { Command } from "commander"
import { analyzeCommand } from "./analyze.js"
import { watchCommand } from "./watch.js"

const program = new Command()

program.addCommand(analyzeCommand)
program.addCommand(watchCommand)

program
  .command("trade")
  .description("Execute a trade (placeholder)")
  .argument("<symbol>", "Symbol to trade")
  .argument("<direction>", "buy or sell")
  .argument("<quantity>", "Number of shares")
  .action((symbol, direction, quantity) => {
    console.log(`Trading ${quantity} shares of ${symbol} (${direction})... (not implemented)`)
  })

program.parse()
