"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  CreditCard, 
  Zap, 
  Database, 
  FileText, 
  Lightbulb, 
  FolderOpen,
  Clock,
  ExternalLink,
  Check,
  AlertTriangle,
  Trash2
} from "lucide-react"
import { extractErrorMessage } from "@/lib/client-errors"
import { recordClientWorkflowEvent } from "@/lib/client-workflow-debug"
import {
  GROWTH_INCLUDED_PROJECTS_PER_MONTH,
  GROWTH_OVERAGE_USD_PER_PROJECT,
  getWorkspacePlanLabel,
  isPaidWorkspacePlan,
  type WorkspacePlan,
} from "@/lib/workspace"

interface UsageStats {
  totalMemories: number
  totalRules: number
  totalDecisions: number
  totalFacts: number
  projectCount: number
  lastSync: string | null
}

interface TenantRoutingStatus {
  isActive: boolean
  readyTenantCount: number
  totalTenantCount: number
  apiKeyConfigured: boolean
  apiKeyExpired: boolean
}

interface BillingContentProps {
  plan: WorkspacePlan
  hasStripeCustomer: boolean
  usage: UsageStats
  memberSince: string | null
  ownerType: "user" | "organization"
  orgRole: "owner" | "admin" | "member" | null
  canManageBilling: boolean
  tenantRouting: TenantRoutingStatus
}

// Reserved for future Free tier comparison UI
const _FREE_LIMITS = {
  memories: "Unlimited",
  projects: "Unlimited",
  sync: "Cloud sync",
  search: "Local semantic search",
}

const PRO_FEATURES = [
  "Cloud sync across all devices",
  "Web dashboard access",
  "MCP API access for v0 & web tools",
  "Server-side semantic search",
  "Priority support",
]

const TEAM_FEATURES = [
  "Everything in Individual",
  "Per-seat organization billing",
  "Owner-managed billing controls",
  "Collaboration-ready workspace settings",
]

const GROWTH_FEATURES = [
  "Everything in Team",
  "500 AI SDK projects included / month",
  "$0.05 per additional AI SDK project",
  "Usage-based metering",
]

function getSwitchPlanTarget(
  ownerType: "user" | "organization",
  currentPlan: WorkspacePlan,
): "individual" | "team" | "growth" {
  if (ownerType === "organization") {
    return currentPlan === "growth" ? "team" : "growth"
  }
  return currentPlan === "growth" ? "individual" : "growth"
}

export function BillingContent({
  plan,
  hasStripeCustomer,
  usage,
  memberSince,
  ownerType,
  orgRole,
  canManageBilling,
  tenantRouting,
}: BillingContentProps): React.JSX.Element {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const isPaidPlan = isPaidWorkspacePlan(plan)
  const isPastDue = plan === "past_due"
  const isOrgWorkspace = ownerType === "organization"
  const currentPlanLabel = getWorkspacePlanLabel(plan)
  const effectivePlanFeatures =
    plan === "growth"
      ? GROWTH_FEATURES
      : plan === "team"
        ? TEAM_FEATURES
        : PRO_FEATURES
  const tenantOverageProjects = Math.max(0, tenantRouting.totalTenantCount - GROWTH_INCLUDED_PROJECTS_PER_MONTH)
  const tenantProjectedOverage = tenantOverageProjects * GROWTH_OVERAGE_USD_PER_PROJECT
  const switchPlanTarget = getSwitchPlanTarget(ownerType, plan)
  const switchPlanHref = `/app/upgrade?plan=${switchPlanTarget}`

  async function handleManageBilling() {
    if (!canManageBilling) return

    setLoading(true)
    setActionError(null)
    const startedAt = performance.now()
    recordClientWorkflowEvent({
      workflow: "billing_portal",
      phase: "start",
    })
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(extractErrorMessage(data, `Failed to open billing portal (HTTP ${res.status})`))
      }
      const redirectUrl =
        data && typeof data === "object" && "url" in data && typeof data.url === "string"
          ? data.url
          : null
      if (redirectUrl) {
        recordClientWorkflowEvent({
          workflow: "billing_portal",
          phase: "success",
          durationMs: performance.now() - startedAt,
          details: {
            redirected: true,
          },
        })
        window.location.href = redirectUrl
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open billing portal"
      setActionError(message)
      recordClientWorkflowEvent({
        workflow: "billing_portal",
        phase: "failure",
        durationMs: performance.now() - startedAt,
        message,
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleUpgrade(planChoice: "individual" | "team" | "growth", billing: "monthly" | "annual") {
    if (!canManageBilling) return

    setLoading(true)
    setActionError(null)
    const startedAt = performance.now()
    recordClientWorkflowEvent({
      workflow: "billing_checkout",
      phase: "start",
      details: { billing, plan: planChoice },
    })
    try {
      const res = await fetch("/api/stripe/checkout", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billing, plan: planChoice }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(extractErrorMessage(data, `Failed to start checkout (HTTP ${res.status})`))
      }
      const redirectUrl =
        data && typeof data === "object" && "url" in data && typeof data.url === "string"
          ? data.url
          : null
      if (redirectUrl) {
        recordClientWorkflowEvent({
          workflow: "billing_checkout",
          phase: "success",
          durationMs: performance.now() - startedAt,
          details: {
            billing,
            plan: planChoice,
            redirected: true,
          },
        })
        window.location.href = redirectUrl
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start checkout"
      setActionError(message)
      recordClientWorkflowEvent({
        workflow: "billing_checkout",
        phase: "failure",
        durationMs: performance.now() - startedAt,
        message,
        details: { billing, plan: planChoice },
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText !== "DELETE") return
    
    setDeleting(true)
    setActionError(null)
    const startedAt = performance.now()
    recordClientWorkflowEvent({
      workflow: "account_delete",
      phase: "start",
    })
    try {
      const res = await fetch("/api/account", { method: "DELETE" })
      if (res.ok) {
        recordClientWorkflowEvent({
          workflow: "account_delete",
          phase: "success",
          durationMs: performance.now() - startedAt,
        })
        router.push("/")
      } else {
        const data = await res.json().catch(() => null)
        const message = extractErrorMessage(data, `Failed to delete account (HTTP ${res.status})`)
        setActionError(message)
        recordClientWorkflowEvent({
          workflow: "account_delete",
          phase: "failure",
          durationMs: performance.now() - startedAt,
          message,
        })
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing & Usage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isOrgWorkspace
            ? "Manage organization billing and view usage"
            : "Manage your subscription and view usage"}
        </p>
        {actionError ? (
          <p className="mt-2 text-sm text-red-400" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>

      {isOrgWorkspace && !canManageBilling && (
        <div className="border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium text-amber-300">Billing is owner-managed</p>
          <p className="text-amber-200/80 mt-1">
            You&apos;re an organization {orgRole || "member"}. Only the organization owner can manage billing actions.
          </p>
        </div>
      )}

      {/* Current Plan */}
      <div className="border border-border bg-card/20">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Current Plan</h2>
          </div>
          <span className={`px-3 py-1 text-xs font-bold uppercase tracking-wider ${
            isPaidPlan || isPastDue
              ? "bg-primary/10 text-primary border border-primary/20"
              : "bg-muted/50 text-muted-foreground border border-border"
          }`}>
            {currentPlanLabel}
          </span>
        </div>

        <div className="p-4 space-y-4">
          {isPaidPlan || isPastDue ? (
            <>
              <p className="text-sm text-muted-foreground">
                {isPastDue
                  ? "Billing is currently past due. Update your payment method to keep all paid features active."
                  : `Your workspace is on the ${currentPlanLabel} plan.`}
              </p>
              <div className="flex flex-wrap gap-2">
                {effectivePlanFeatures.map((feature) => (
                  <span key={feature} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="h-3 w-3 text-green-400" />
                    {feature}
                  </span>
                ))}
              </div>
              {canManageBilling && (
                <div className="flex flex-wrap items-center gap-3">
                  {hasStripeCustomer && (
                    <button
                      onClick={handleManageBilling}
                      disabled={loading}
                      className="flex items-center gap-2 px-4 py-2 bg-muted/30 hover:bg-muted/50 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {loading ? "Loading..." : "Manage Subscription"}
                    </button>
                  )}
                  <Link
                    href={switchPlanHref}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Zap className="h-4 w-4" />
                    Switch Plan
                  </Link>
                </div>
              )}
              {!canManageBilling && (
                <p className="text-xs text-muted-foreground">
                  Billing changes are restricted to the organization owner.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                You&apos;re on the Free plan. Upgrade to unlock hosted memory and production AI SDK project routing.
              </p>
              {canManageBilling ? (
                <div className="space-y-3">
                  {ownerType === "organization" ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => handleUpgrade("team", "monthly")}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        <Zap className="h-4 w-4" />
                        {loading ? "Loading..." : "Team — $25/seat/mo"}
                      </button>
                      <button
                        onClick={() => handleUpgrade("team", "annual")}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-muted/50 border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {loading ? "Loading..." : "Team — $240/seat/year"}
                      </button>
                      <button
                        onClick={() => handleUpgrade("growth", "monthly")}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-muted/50 border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {loading ? "Loading..." : "Growth — $299/mo"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => handleUpgrade("individual", "monthly")}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        <Zap className="h-4 w-4" />
                        {loading ? "Loading..." : "Individual — $15/mo"}
                      </button>
                      <button
                        onClick={() => handleUpgrade("individual", "annual")}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-muted/50 border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {loading ? "Loading..." : "Individual — $150/year"}
                      </button>
                      <button
                        onClick={() => handleUpgrade("growth", "monthly")}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-muted/50 border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {loading ? "Loading..." : "Growth — $299/mo"}
                      </button>
                    </div>
                  )}
                  <Link
                    href="/#pricing"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View details
                  </Link>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Upgrade actions are restricted to the organization owner.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Usage Stats */}
      <div className="border border-border bg-card/20">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Usage</h2>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <UsageStat
              icon={<Database className="h-4 w-4" />}
              label="Total Memories"
              value={usage.totalMemories}
            />
            <UsageStat
              icon={<FileText className="h-4 w-4" />}
              label="Rules"
              value={usage.totalRules}
            />
            <UsageStat
              icon={<Lightbulb className="h-4 w-4" />}
              label="Decisions"
              value={usage.totalDecisions}
            />
            <UsageStat
              icon={<FolderOpen className="h-4 w-4" />}
              label="Git Repositories"
              value={usage.projectCount}
            />
          </div>

          {usage.lastSync && (
            <div className="mt-4 pt-4 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Last activity: {new Date(usage.lastSync).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {/* AI SDK Projects */}
      <div className="border border-border bg-card/20">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">AI SDK Projects</h2>
          </div>
          <span
            className={`px-3 py-1 text-xs font-bold uppercase tracking-wider border ${
              tenantRouting.isActive
                ? "bg-green-500/10 text-green-400 border-green-500/30"
                : "bg-muted/50 text-muted-foreground border-border"
            }`}
          >
            {tenantRouting.isActive ? "Active" : "Inactive"}
          </span>
        </div>

        <div className="p-4 space-y-3 text-sm">
          <p className="text-muted-foreground">
            Routes SDK traffic by <code className="text-foreground">tenantId</code> to isolated Turso databases.
          </p>
          {plan === "growth" ? (
            <p className="text-xs text-emerald-300/90">
              Includes {GROWTH_INCLUDED_PROJECTS_PER_MONTH.toLocaleString()} projects per month, then $
              {GROWTH_OVERAGE_USD_PER_PROJECT.toFixed(2)} per additional project.
            </p>
          ) : (
            <p className="text-xs text-amber-300/90">
              Growth plan required for usage-based AI SDK project metering.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-muted/20 border border-border">
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Ready Projects</p>
              <p className="text-xl font-bold mt-1">{tenantRouting.readyTenantCount}</p>
            </div>
            <div className="p-3 bg-muted/20 border border-border">
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">API Key Status</p>
              <p className="text-sm font-medium mt-1">
                {!tenantRouting.apiKeyConfigured
                  ? "Not configured"
                  : tenantRouting.apiKeyExpired
                  ? "Expired"
                  : "Active"}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Total active projects (excluding disabled): {tenantRouting.totalTenantCount}
          </p>
          {plan === "growth" && tenantOverageProjects > 0 && (
            <p className="text-xs text-muted-foreground">
              Current overage estimate: {tenantOverageProjects.toLocaleString()} projects (about $
              {tenantProjectedOverage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              /month)
            </p>
          )}
          <div>
            <Link
              href="/app/sdk-projects"
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Manage AI SDK projects
            </Link>
          </div>
        </div>
      </div>

      {/* Account Info */}
      <div className="border border-border bg-card/20">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Account</h2>
        </div>

        <div className="p-4 space-y-2 text-sm">
          {memberSince && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Member since</span>
              <span>{new Date(memberSince).toLocaleDateString()}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Database</span>
            <span className="text-green-400">Connected</span>
          </div>
        </div>
      </div>

      {/* Plan Comparison */}
      {plan === "free" && (
        <div className="border border-border bg-card/20">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Free vs Individual</h2>
          </div>

          <div className="p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium">Feature</th>
                  <th className="text-center py-2 font-medium">Free</th>
                  <th className="text-center py-2 font-medium text-primary">Individual</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border">
                  <td className="py-2">Local CLI & MCP</td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2">Unlimited memories</td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2">Local semantic search</td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2">Cloud sync</td>
                  <td className="text-center py-2">—</td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2">Web dashboard</td>
                  <td className="text-center py-2">—</td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2">MCP API (v0, web tools)</td>
                  <td className="text-center py-2">—</td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                </tr>
                <tr>
                  <td className="py-2">Priority support</td>
                  <td className="text-center py-2">—</td>
                  <td className="text-center py-2"><Check className="h-4 w-4 text-green-400 inline" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Danger Zone */}
      <div className="border border-red-500/30 bg-red-500/5">
        <div className="p-4 border-b border-red-500/30 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <h2 className="font-semibold text-red-400">Danger Zone</h2>
        </div>

        <div className="p-4 space-y-6">
          {/* Cancel Subscription (paid plans) */}
          {(isPaidPlan || isPastDue) && hasStripeCustomer && canManageBilling && (
            <div className="flex items-start justify-between gap-4 pb-6 border-b border-red-500/20">
              <div>
                <h3 className="font-medium text-sm">Cancel Subscription</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Downgrade to the Free plan. You&apos;ll lose cloud sync and web dashboard access at the end of your billing period.
                </p>
              </div>
              <button
                onClick={handleManageBilling}
                disabled={loading}
                className="shrink-0 px-4 py-2 text-xs font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                {loading ? "Loading..." : "Cancel Plan"}
              </button>
            </div>
          )}

          {/* Delete Account */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-medium text-sm">Delete Account</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Permanently delete your account and all data. This action cannot be undone.
                {(isPaidPlan || isPastDue) && " Your subscription will be cancelled immediately."}
              </p>
            </div>
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="shrink-0 px-4 py-2 text-xs font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Delete Account
              </button>
            ) : (
              <div className="shrink-0 flex flex-col gap-2">
                <p className="text-xs text-red-400">Type DELETE to confirm:</p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="px-3 py-1.5 text-sm bg-background border border-red-500/30 focus:outline-none focus:border-red-500"
                  placeholder="DELETE"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== "DELETE" || deleting}
                    className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    {deleting ? "Deleting..." : "Confirm Delete"}
                  </button>
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false)
                      setDeleteConfirmText("")
                    }}
                    className="px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted/50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function UsageStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="p-3 bg-muted/20 border border-border">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  )
}
