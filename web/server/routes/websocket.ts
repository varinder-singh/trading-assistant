import { wsConnectionManager } from "../utils/websocket-connection-manager.js"
import { handleAuthCommand } from "../utils/websocket-auth-handler.js"
import { handleWatchCommand } from "../utils/websocket-watch-handler.js"

// Initialize global event listeners on first import
wsConnectionManager.setupGlobalListeners()

export default defineWebSocketHandler({
  open(peer) {
    console.log(`[ws] open ${peer.id}`)
  },

  async message(peer, message) {
    const text = message.text()
    if (!text) return

    try {
      const msg = JSON.parse(text)

      if (msg.type === "auth") {
        await handleAuthCommand(peer, msg)
        return
      }

      if (msg.type === "watch") {
        await handleWatchCommand(peer, msg)
        return
      }
    } catch (err) {
      console.error("[ws] error handling message", err)
    }
  },

  close(peer) {
    console.log(`[ws] close ${peer.id}`)
    wsConnectionManager.removeClient(peer.id)
  },

  error(peer, error) {
    console.log(`[ws] error ${peer.id}`, error)
  },
})
