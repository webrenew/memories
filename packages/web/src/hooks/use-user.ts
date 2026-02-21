"use client"

import { createClient } from "@/lib/supabase/client"
import { useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"

type UserSubscriber = (state: { user: User | null; loading: boolean }) => void

let cachedUser: User | null = null
let hasResolvedUser = false
let isBootstrapping = false
let authStateGeneration = 0
let authInitialized = false
let authSubscription: { unsubscribe: () => void } | null = null
const subscribers = new Set<UserSubscriber>()

function notifySubscribers(state: { user: User | null; loading: boolean }): void {
  subscribers.forEach((subscriber) => subscriber(state))
}

async function bootstrapAuthState() {
  if (isBootstrapping || hasResolvedUser) return
  isBootstrapping = true
  const generation = authStateGeneration
  let user: User | null = null
  try {
    const supabase = createClient()
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    user = null
  }

  if (generation !== authStateGeneration) return

  cachedUser = user
  hasResolvedUser = true
  isBootstrapping = false
  notifySubscribers({ user: cachedUser, loading: false })
}

function initializeAuthSubscription() {
  if (authInitialized) return
  authInitialized = true
  const supabase = createClient()

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    cachedUser = session?.user ?? null
    hasResolvedUser = true
    notifySubscribers({ user: cachedUser, loading: false })
  })

  authSubscription = subscription
  void bootstrapAuthState()
}

export function useUser(): { user: User | null; loading: boolean } {
  const [state, setState] = useState<{ user: User | null; loading: boolean }>({
    user: hasResolvedUser ? cachedUser : null,
    loading: !hasResolvedUser,
  })

  useEffect(() => {
    initializeAuthSubscription()

    const subscriber: UserSubscriber = (nextState) => setState(nextState)
    subscribers.add(subscriber)

    if (hasResolvedUser) {
      setState({ user: cachedUser, loading: false })
    }

    return () => {
      subscribers.delete(subscriber)
      if (subscribers.size === 0 && authSubscription) {
        authStateGeneration += 1
        authSubscription.unsubscribe()
        authSubscription = null
        authInitialized = false
        hasResolvedUser = false
        isBootstrapping = false
        cachedUser = null
      }
    }
  }, [])

  return state
}
