import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { reconcileUserAccountByEmail } from "@/lib/account-reconciliation"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const rawNext = searchParams.get("next") ?? "/app"
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (user) {
          await reconcileUserAccountByEmail(user)
        }
      } catch (reconciliationError) {
        // Do not block login on reconciliation failures.
        console.error("Auth callback reconciliation failed:", reconciliationError)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth`)
}
