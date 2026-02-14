import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { reconcileUserAccountByEmail } from "@/lib/account-reconciliation"
import { autoJoinOrganizationsForEmails, extractUserEmails } from "@/lib/domain-auto-join"
import { hasServiceRoleKey } from "@/lib/env"

export async function GET(request: Request): Promise<Response> {
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
          const tasks: Promise<unknown>[] = [reconcileUserAccountByEmail(user)]
          if (hasServiceRoleKey()) {
            tasks.push(autoJoinOrganizationsForEmails({
              userId: user.id,
              emails: extractUserEmails(user),
            }))
          }
          await Promise.all(tasks)
        }
      } catch (postLoginError) {
        // Do not block login on post-auth account hydration failures.
        console.error("Auth callback post-login setup failed:", postLoginError)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth`)
}
