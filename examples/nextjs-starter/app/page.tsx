"use client"

import { FormEvent, useMemo, useState } from "react"

type ApiResult = {
  ok: boolean
  result?: unknown
  memories?: unknown[]
  rules?: unknown[]
  trace?: unknown
  error?: {
    message?: string
  }
}

const DEFAULT_CONTEXT_QUERY = "What should my assistant remember about this project?"

export default function HomePage() {
  const [projectId, setProjectId] = useState("")

  const [addContent, setAddContent] = useState("Starter memory: team prefers concise release notes with exact dates.")
  const [addType, setAddType] = useState("note")
  const [addTags, setAddTags] = useState("starter,docs")
  const [addResponse, setAddResponse] = useState<unknown>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)

  const [searchQuery, setSearchQuery] = useState("release notes")
  const [searchResponse, setSearchResponse] = useState<unknown[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)

  const [contextQuery, setContextQuery] = useState(DEFAULT_CONTEXT_QUERY)
  const [contextMode, setContextMode] = useState("all")
  const [contextStrategy, setContextStrategy] = useState("baseline")
  const [contextResponse, setContextResponse] = useState<unknown>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [contextBusy, setContextBusy] = useState(false)

  const projectParam = useMemo(() => {
    const trimmed = projectId.trim()
    return trimmed.length > 0 ? `&projectId=${encodeURIComponent(trimmed)}` : ""
  }, [projectId])

  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAddBusy(true)
    setAddError(null)

    try {
      const tags = addTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
      const response = await fetch("/api/memories/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: addContent,
          type: addType,
          tags,
          projectId: projectId.trim() || undefined,
        }),
      })

      const body = (await response.json()) as ApiResult
      if (!response.ok || !body.ok) {
        throw new Error(body.error?.message ?? "Failed to add memory")
      }

      setAddResponse(body.result ?? body)
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Unexpected error")
    } finally {
      setAddBusy(false)
    }
  }

  async function searchMemories(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSearchBusy(true)
    setSearchError(null)

    try {
      const response = await fetch(
        `/api/memories/search?q=${encodeURIComponent(searchQuery.trim())}&limit=12${projectParam}`
      )
      const body = (await response.json()) as ApiResult
      if (!response.ok || !body.ok) {
        throw new Error(body.error?.message ?? "Failed to search memories")
      }
      setSearchResponse(Array.isArray(body.memories) ? body.memories : [])
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Unexpected error")
    } finally {
      setSearchBusy(false)
    }
  }

  async function getContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setContextBusy(true)
    setContextError(null)

    try {
      const url =
        `/api/memories/context?q=${encodeURIComponent(contextQuery.trim())}` +
        `&mode=${encodeURIComponent(contextMode)}` +
        `&strategy=${encodeURIComponent(contextStrategy)}` +
        `&limit=10${projectParam}`

      const response = await fetch(url)
      const body = (await response.json()) as ApiResult
      if (!response.ok || !body.ok) {
        throw new Error(body.error?.message ?? "Failed to fetch context")
      }

      setContextResponse({
        rules: body.rules,
        memories: body.memories,
        trace: body.trace,
      })
    } catch (error) {
      setContextError(error instanceof Error ? error.message : "Unexpected error")
    } finally {
      setContextBusy(false)
    }
  }

  return (
    <main>
      <header>
        <span className="badge">Memories Starter</span>
        <h1>Add, Search, and Context in One Next.js App</h1>
        <p>
          This starter wires `@memories.sh/core` through API routes so your browser never exposes the API key.
          Set `MEMORIES_API_KEY`, optionally set workspace/user/project defaults, and run flows below.
        </p>
      </header>

      <section className="panel">
        <h2>Scope Defaults</h2>
        <p className="muted">
          Optional project override for all calls. Tenant/user defaults come from environment variables.
        </p>
        <label>
          Project ID (optional)
          <input value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="starter-demo" />
        </label>
      </section>

      <section className="grid">
        <form className="panel" onSubmit={addMemory}>
          <h2>Add Memory</h2>
          <label>
            Content
            <textarea value={addContent} onChange={(event) => setAddContent(event.target.value)} required />
          </label>
          <label>
            Type
            <select value={addType} onChange={(event) => setAddType(event.target.value)}>
              <option value="note">note</option>
              <option value="rule">rule</option>
              <option value="fact">fact</option>
              <option value="decision">decision</option>
              <option value="skill">skill</option>
            </select>
          </label>
          <label>
            Tags (comma separated)
            <input value={addTags} onChange={(event) => setAddTags(event.target.value)} placeholder="starter,docs" />
          </label>
          <button type="submit" disabled={addBusy}>
            {addBusy ? "Adding..." : "Add Memory"}
          </button>
          {addError ? <p className="error">{addError}</p> : null}
          <pre className="output">{JSON.stringify(addResponse, null, 2)}</pre>
        </form>

        <form className="panel" onSubmit={searchMemories}>
          <h2>Search Memories</h2>
          <label>
            Query
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} required />
          </label>
          <button type="submit" disabled={searchBusy}>
            {searchBusy ? "Searching..." : "Search"}
          </button>
          {searchError ? <p className="error">{searchError}</p> : null}
          <pre className="output">{JSON.stringify(searchResponse, null, 2)}</pre>
        </form>

        <form className="panel" onSubmit={getContext}>
          <h2>Get Context</h2>
          <label>
            Query
            <textarea value={contextQuery} onChange={(event) => setContextQuery(event.target.value)} required />
          </label>
          <label>
            Mode
            <select value={contextMode} onChange={(event) => setContextMode(event.target.value)}>
              <option value="all">all</option>
              <option value="working">working</option>
              <option value="long_term">long_term</option>
              <option value="rules_only">rules_only</option>
            </select>
          </label>
          <label>
            Strategy
            <select value={contextStrategy} onChange={(event) => setContextStrategy(event.target.value)}>
              <option value="baseline">baseline</option>
              <option value="hybrid_graph">hybrid_graph</option>
            </select>
          </label>
          <button type="submit" disabled={contextBusy}>
            {contextBusy ? "Loading..." : "Fetch Context"}
          </button>
          {contextError ? <p className="error">{contextError}</p> : null}
          <pre className="output">{JSON.stringify(contextResponse, null, 2)}</pre>
        </form>
      </section>
    </main>
  )
}
