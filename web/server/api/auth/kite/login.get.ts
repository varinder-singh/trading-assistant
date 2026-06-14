import { createKiteClient } from "@core/data/kite.js"
import { serverSupabaseUser } from "#supabase/server"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  
  if (!user) {
    return sendRedirect(event, "/login")
  }

  const kc = createKiteClient()
  const loginUrl = kc.getLoginURL()
  
  return sendRedirect(event, loginUrl)
})
