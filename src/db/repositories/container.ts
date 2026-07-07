import { db } from '../database.js'
import { UserRepository } from './user-repo.js'
import { TradeRepository } from './trade-repo.js'
import { GtiRepository } from './gti-repo.js'
import { EventRepository } from './event-repo.js'

// Composition Root: Instantiate and wire up repositories with their dependencies
export const userRepo = new UserRepository(db)
export const tradeRepo = new TradeRepository(db)
export const gtiRepo = new GtiRepository(db)
export const eventRepo = new EventRepository(db)
