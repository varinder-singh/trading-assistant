import { EventEmitter } from "node:events"

class EventHub extends EventEmitter {}

export const eventHub = new EventHub()
