export interface Organization {
  id: string
  name: string
  slug: string
  owner_id: string
  plan: string
  created_at: string
  role: string
  domain_auto_join_enabled?: boolean | null
  domain_auto_join_domain?: string | null
}

export interface OrganizationDetails {
  id: string
  domain_auto_join_enabled?: boolean | null
  domain_auto_join_domain?: string | null
  updated_at?: string | null
}

export interface GithubCaptureSettings {
  allowed_events: Array<"pull_request" | "issues" | "push" | "release">
  repo_allow_list: string[]
  repo_block_list: string[]
  branch_filters: string[]
  label_filters: string[]
  actor_filters: string[]
  include_prerelease: boolean
}

export interface Member {
  id: string
  role: string
  joined_at: string | null
  last_login_at: string | null
  memory_count: number
  user_memory_count: number
  user: {
    id: string
    email: string
    name: string | null
    avatar_url: string | null
  }
}

export interface Invite {
  id: string
  email: string
  role: string
  created_at: string
  expires_at: string
  inviter: {
    name: string | null
    email: string
  }
}

export interface AuditEvent {
  id: string
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  actor_user_id: string | null
  actor: {
    id: string
    email: string | null
    name: string | null
  } | null
}
