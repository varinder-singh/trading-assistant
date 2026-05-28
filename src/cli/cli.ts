import "dotenv/config"
import { Command } from "commander"
import { analyzeCommand } from "./analyze.js"
import { watchCommand } from "./watch.js"

const program = new Command()

program.addCommand(analyzeCommand)
program.addCommand(watchCommand)

program.parse()
