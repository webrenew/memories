import type { User } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { extractGithubAccountLink } from "@/lib/github-capture"

export async function syncGithubAccountLink(user: User): Promise<void> {
  const link = extractGithubAccountLink(user)
  const admin = createAdminClient()

  if (!link) {
    const { error } = await admin
      .from("github_account_links")
      .delete()
      .eq("user_id", user.id)

    if (error) {
      console.error("Failed to remove stale github account link:", error)
    }
    return
  }

  const { error } = await admin
    .from("github_account_links")
    .upsert(
      {
        user_id: user.id,
        github_login: link.githubLogin,
        github_user_id: link.githubUserId,
      },
      { onConflict: "user_id" }
    )

  if (error) {
    console.error("Failed to sync github account link:", error)
  }
}
