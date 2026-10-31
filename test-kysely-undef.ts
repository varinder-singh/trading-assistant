import { db } from './src/db/database.js'
import crypto from 'node:crypto'
const userId = undefined as any
const query = db
  .insertInto('brokerAccounts')
  .values({
    id: crypto.randomUUID(),
    userId: userId,
    brokerName: 'zerodha',
    brokerUserId: 'AB123',
    accessToken: 'token',
    publicToken: 'token',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  .compile()
console.log(query.sql)
