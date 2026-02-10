import { authenticateRequest } from "@/lib/auth"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveWorkspaceContext } from "@/lib/workspace"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  const workspace = await resolveWorkspaceContext(admin, auth.userId)
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  return NextResponse.json({
    workspace: {
      ownerType: workspace.ownerType,
      orgId: workspace.orgId,
      orgRole: workspace.orgRole,
      plan: workspace.plan,
      hasDatabase: workspace.hasDatabase,
      canProvision: workspace.canProvision,
    },
  })
}
