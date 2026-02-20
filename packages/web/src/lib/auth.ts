import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashCliToken } from "@/lib/cli-token"

interface AuthResult {
  userId: string
  email: string
}

/**
 * Authenticate a request via Supabase session cookies OR CLI Bearer token.
 * Returns the user ID and email, or null if unauthenticated.
 */
export async function authenticateRequest(
  request: Request
): Promise<AuthResult | null> {
  // Check for CLI Bearer token first
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer cli_")) {
    const token = authHeader.replace("Bearer ", "")
    const tokenHash = hashCliToken(token)
    const admin = createAdminClient()

    const { data: hashedUser, error: hashedError } = await admin
      .from("users")
      .select("id, email")
      .eq("cli_token_hash", tokenHash)
      .maybeSingle()

    if (hashedError) {
      console.error("CLI token hash lookup failed:", hashedError)
      return null
    }

    if (hashedUser) {
      return { userId: hashedUser.id, email: hashedUser.email }
    }

    return null
  }

  // Fall back to Supabase session auth (cookies)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    return { userId: user.id, email: user.email ?? "" }
  }

  return null
}
