import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { parseRequestedApiKeyExpiry } from "@/lib/api-key-expiry"
import {
  createSdkProject,
  isDuplicateSdkProjectError,
  isMissingSdkProjectsTableError,
  listSdkProjectsForOwner,
} from "@/lib/sdk-project-store"
import { createUserApiKey, revokeUserApiKeys } from "@/lib/mcp-api-key-store"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { buildSdkTenantOwnerScopeKey } from "@/lib/sdk-project-billing"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveWorkspaceContext } from "@/lib/workspace"

const createProjectSchema = z.object({
  displayName: z.string().trim().min(1, "Project name is required").max(80, "Project name is too long"),
  tenantId: z.string().trim().min(1, "tenantId is required").max(120, "tenantId is too long"),
  description: z.string().trim().max(240, "Description is too long").optional(),
  generateApiKey: z.boolean().optional().default(false),
  expiresAt: z.string().optional(),
})

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

async function resolveWorkspaceOwnerScope(userId: string) {
  const admin = createAdminClient()
  const workspace = await resolveWorkspaceContext(admin, userId)
  if (!workspace) {
    return { admin, workspace: null as null, ownerScopeKey: null as string | null }
  }

  if (workspace.ownerType === "organization" && !workspace.orgId) {
    throw new Error("Organization workspace is missing orgId")
  }

  const ownerScopeKey = buildSdkTenantOwnerScopeKey({
    ownerType: workspace.ownerType,
    ownerUserId: userId,
    orgId: workspace.orgId ?? null,
  })

  return { admin, workspace, ownerScopeKey }
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return jsonError("Unauthorized", 401)
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  try {
    const { admin, workspace, ownerScopeKey } = await resolveWorkspaceOwnerScope(auth.userId)
    if (!workspace || !ownerScopeKey) {
      return jsonError("Workspace context unavailable", 404)
    }

    const projects = await listSdkProjectsForOwner(admin, ownerScopeKey)
    return NextResponse.json({ projects })
  } catch (error) {
    if (isMissingSdkProjectsTableError(error)) {
      return jsonError("SDK projects are not available until the latest database migration is applied.", 503)
    }

    console.error("Failed to list SDK projects:", error)
    return jsonError("Failed to load AI SDK projects", 500)
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return jsonError("Unauthorized", 401)
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  let rawBody: unknown = {}
  try {
    rawBody = await request.json()
  } catch {
    rawBody = {}
  }

  const parsed = createProjectSchema.safeParse(rawBody)
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request payload", 400)
  }

  try {
    const { admin, workspace, ownerScopeKey } = await resolveWorkspaceOwnerScope(auth.userId)
    if (!workspace || !ownerScopeKey) {
      return jsonError("Workspace context unavailable", 404)
    }

    if (workspace.plan === "past_due") {
      return jsonError("Billing is past due. Update payment method before creating new AI SDK projects.", 403)
    }

    if (!workspace.canProvision) {
      return jsonError("Only workspace owners or admins can create AI SDK projects in this workspace.", 403)
    }

    let createdKey:
      | {
          keyId: string
          apiKey: string
          keyPreview: string | null
          createdAt: string
          expiresAt: string
        }
      | null = null

    if (parsed.data.generateApiKey) {
      const expiry = parseRequestedApiKeyExpiry(parsed.data.expiresAt)
      if ("error" in expiry) {
        return jsonError(expiry.error, 400)
      }

      createdKey = await createUserApiKey(admin, {
        userId: auth.userId,
        expiresAt: expiry.expiresAt,
      })
    }

    try {
      const project = await createSdkProject(admin, {
        ownerScopeKey,
        ownerType: workspace.ownerType,
        ownerUserId: workspace.ownerType === "user" ? auth.userId : null,
        ownerOrgId: workspace.ownerType === "organization" ? workspace.orgId ?? null : null,
        createdByUserId: auth.userId,
        tenantId: parsed.data.tenantId,
        displayName: parsed.data.displayName,
        description: parsed.data.description || undefined,
      })

      return NextResponse.json({
        project,
        apiKey: createdKey,
      })
    } catch (error) {
      if (createdKey) {
        try {
          await revokeUserApiKeys(admin, {
            userId: auth.userId,
            keyId: createdKey.keyId,
          })
        } catch (cleanupError) {
          console.error("Failed to revoke API key after SDK project creation failure:", cleanupError)
        }
      }

      if (isMissingSdkProjectsTableError(error)) {
        return jsonError("SDK projects are not available until the latest database migration is applied.", 503)
      }

      if (isDuplicateSdkProjectError(error)) {
        return jsonError("An AI SDK project with that tenantId already exists in this workspace.", 409)
      }

      throw error
    }
  } catch (error) {
    console.error("Failed to create SDK project:", error)
    return jsonError("Failed to create AI SDK project", 500)
  }
}
