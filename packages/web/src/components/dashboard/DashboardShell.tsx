"use client"

import Link from "next/link"
import Image from "next/image"
import { useCallback, useEffect, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { BookOpen, KeyRound, Network } from "lucide-react"
import { Database, BarChart3, Settings, Sparkles, LogOut, AlertTriangle, CreditCard, Users } from "@/components/icons/app"
import { WorkspaceSwitcher, type OrgMembership } from "./WorkspaceSwitcher"
import { ClientWorkflowDebugPanel } from "./ClientWorkflowDebugPanel"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { extractErrorMessage } from "@/lib/client-errors"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Profile {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
}

interface WorkspaceSummary {
  ownerType: "user" | "organization"
  orgRole: "owner" | "admin" | "member" | null
  plan: "free" | "pro" | "past_due"
}

const navItems = [
  { href: "/app", label: "Memories", icon: Database },
  { href: "/app/sdk-projects", label: "SDK Projects", icon: KeyRound },
  { href: "/app/stats", label: "Stats", icon: BarChart3 },
  { href: "/app/graph-explorer", label: "Graph", icon: Network },
  { href: "/app/team", label: "Team", icon: Users },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/docs", label: "Docs", icon: BookOpen, external: true },
  { href: "/app/settings", label: "Settings", icon: Settings },
]

export function DashboardShell({
  user,
  profile,
  workspace,
  currentOrgId,
  memberships,
  children,
}: {
  user: User
  profile: Profile | null
  workspace: WorkspaceSummary
  currentOrgId: string | null
  memberships: OrgMembership[]
  children: React.ReactNode
}): React.JSX.Element {
  const pathname = usePathname()
  const router = useRouter()
  const displayName = profile?.name ?? user.email?.split("@")[0] ?? "User"
  const plan = workspace.plan
  const canManageBilling =
    workspace.ownerType === "user" || workspace.orgRole === "owner"
  const sidebarOffsetClass =
    plan === "past_due"
      ? "top-[6.25rem] h-[calc(100vh-6.25rem)]"
      : "top-16 h-[calc(100vh-4rem)]"
  const internalNavItems = useMemo(() => navItems.filter((item) => !item.external), [])

  const prefetchRoute = useCallback(
    (href: string) => {
      router.prefetch(href)
    },
    [router],
  )

  useEffect(() => {
    for (const item of internalNavItems) {
      prefetchRoute(item.href)
    }
  }, [internalNavItems, prefetchRoute])

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <div className="memory-lattice" />

      {/* Past due banner */}
      {plan === "past_due" && (
        <div className="fixed top-0 left-0 w-full z-[60] bg-destructive/10 border-b border-destructive/30 px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
            <span className="text-xs font-bold uppercase tracking-wider text-destructive">
              Payment failed
            </span>
            {canManageBilling ? (
              <>
                <span className="text-xs text-destructive/80 mx-1">—</span>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await fetch("/api/stripe/portal", { method: "POST" })
                    const data = await res.json().catch(() => null)
                    if (!res.ok) {
                      console.error(extractErrorMessage(data, `Failed to open billing portal (HTTP ${res.status})`))
                      return
                    }
                    if (data && typeof data === "object" && "url" in data && typeof data.url === "string") {
                      window.location.href = data.url
                    }
                  }}
                  className="text-xs font-bold uppercase tracking-wider text-destructive underline underline-offset-2 hover:text-destructive/80"
                >
                  Update payment method
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-destructive/80 mx-1">—</span>
                <span className="text-xs text-destructive/80">
                  Contact your organization owner to update billing.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className={`fixed left-0 w-full z-50 border-b border-border bg-background/80 backdrop-blur-2xl ${plan === "past_due" ? "top-9" : "top-0"}`}>
        <div className="px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-3 group">
              <Image
                src="/memories.svg"
                alt="memories.sh"
                width={24}
                height={24}
                className="w-6 h-6 dark:invert group-hover:scale-110 transition-transform duration-500"
              />
              <span className="font-mono text-xs font-bold tracking-tighter uppercase hidden sm:block text-foreground">
                memories.sh
              </span>
            </Link>

            <div className="hidden sm:block h-5 w-px bg-border" />

            <div className="hidden sm:block">
              <WorkspaceSwitcher
                currentOrgId={currentOrgId}
                memberships={memberships}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            {plan !== "pro" && canManageBilling && (
              <Link
                href="/app/upgrade"
                className="hidden sm:flex items-center gap-2 px-4 py-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all duration-300"
              >
                <Sparkles className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-[0.15em] font-bold">
                  Upgrade
                </span>
              </Link>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-3 rounded-md p-1 hover:bg-muted/40 transition-colors"
                  aria-label="Open account menu"
                >
                  <div className="text-right hidden sm:block">
                    <p className="text-xs font-bold">{displayName}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {plan} plan
                    </p>
                  </div>
                  {profile?.avatar_url ? (
                    <Image
                      src={profile.avatar_url}
                      alt=""
                      width={32}
                      height={32}
                      className="w-8 h-8 rounded-full border border-border"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-bold">
                      {displayName[0]?.toUpperCase()}
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-2">
                <DropdownMenuLabel className="px-2 py-1">
                  <p className="text-xs font-bold">{displayName}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-2 space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground">
                    Theme
                  </p>
                  <ThemeSwitcher />
                </div>
                <DropdownMenuSeparator />
                <form action="/auth/signout" method="post">
                  <DropdownMenuItem asChild>
                    <button type="submit" className="w-full">
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Content area with sidebar */}
      <div className={`flex ${plan === "past_due" ? "pt-[6.25rem]" : "pt-16"}`}>
        {/* Sidebar */}
        <aside className={`hidden md:fixed md:left-0 md:z-40 md:flex flex-col w-56 border-r border-border ${sidebarOffsetClass} p-4 overflow-hidden bg-background`}>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 space-y-1">
            {navItems.map((item) => {
              const isActive = !item.external && (
                item.href === "/app"
                  ? pathname === "/app"
                  : pathname.startsWith(item.href)
              )
              const Icon = item.icon

              if (item.external) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3 text-xs uppercase tracking-[0.15em] font-bold transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </a>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  onMouseEnter={() => prefetchRoute(item.href)}
                  onFocus={() => prefetchRoute(item.href)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 px-4 py-3 text-xs uppercase tracking-[0.15em] font-bold transition-all duration-200 ${
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              )
            })}
          </div>

        </aside>

        {/* Sidebar spacer for desktop fixed rail */}
        <div className="hidden md:block w-56 shrink-0" aria-hidden />

        {/* Mobile nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-2xl border-t border-border">
          <div className="flex items-center justify-around h-14">
            {navItems.map((item) => {
              const isActive = !item.external && (
                item.href === "/app"
                  ? pathname === "/app"
                  : pathname.startsWith(item.href)
              )
              const Icon = item.icon

              if (item.external) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1 px-4 py-2 text-muted-foreground"
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[9px] uppercase tracking-wider font-bold">
                      {item.label}
                    </span>
                  </a>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  onMouseEnter={() => prefetchRoute(item.href)}
                  onFocus={() => prefetchRoute(item.href)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex flex-col items-center gap-1 px-4 py-2 ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[9px] uppercase tracking-wider font-bold">
                    {item.label}
                  </span>
                </Link>
              )
            })}
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 min-w-0 w-full min-h-[calc(100vh-4rem)] p-6 md:p-8 pb-20 md:pb-8 text-[15px] leading-7">
          {children}
        </main>
      </div>
      <ClientWorkflowDebugPanel />
    </div>
  )
}
