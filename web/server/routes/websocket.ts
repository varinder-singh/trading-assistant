import { wsConnectionManager } from '../utils/websocket-connection-manager.js'
import { ClientConnection } from '../utils/client-connection.js'

// Initialize global event listeners on first import
wsConnectionManager.setupGlobalListeners()

export default defineWebSocketHandler({
  // peer is internal to Nuxt and represents a WebSocket connection
  open(peer) {
    console.log(`[ws] open ${peer.id}`)
    const connection = new ClientConnection(peer)
    wsConnectionManager.addClient(peer.id, connection)
  },

  async message(peer, message) {
    const text = message.text()
    if (!text) return

    const connection = wsConnectionManager.getClient(peer.id)
    if (connection) {
      await connection.handleMessage(text)
    } else {
      console.warn(`[ws] Received message on peer ${peer.id} but no ClientConnection was found.`)
    }
  },

  close(peer) {
    console.log(`[ws] close ${peer.id}`)
    wsConnectionManager.removeClient(peer.id)
  },

  error(peer, error) {
    console.log(`[ws] error ${peer.id}`, error)
    wsConnectionManager.removeClient(peer.id)
  },
})
