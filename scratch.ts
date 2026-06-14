import { sessionManager } from "./src/execution/session-manager.js"

async function run() {
  try {
    await sessionManager.getSession("test-user", "test-token")
    console.log("Success")
  } catch (e) {
    console.error("Crash:", e)
    process.exit(1)
  }
}
run()
