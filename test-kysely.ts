import { db } from "./src/db/database.js";
import crypto from "node:crypto";
const query = db.insertInto("brokerAccounts").values({
  id: crypto.randomUUID(),
  userId: "123",
  brokerName: "zerodha",
  brokerUserId: "AB123",
  accessToken: "token",
  publicToken: "token",
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}).compile();
console.log(query.sql);
