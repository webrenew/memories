import "dotenv/config"
import cors from "cors"
import express from "express"
import { createMemoriesClient, toErrorPayload } from "./memories-client.js"

const app = express()
const port = Number(process.env.PORT || 8787)

const allowedTypes = new Set(["rule", "decision", "fact", "note", "skill"])
const allowedLayers = new Set(["rule", "working", "long_term"])
const allowedModes = new Set(["all", "working", "long_term", "rules_only"])
const allowedStrategies = new Set(["baseline", "hybrid_graph"])

app.use(cors())
app.use(express.json({ limit: "1mb" }))

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "memories-express-starter" })
})

app.post("/memories/add", async (req, res) => {
  try {
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : ""
    if (!content) {
      return res.status(400).json({
        ok: false,
        error: {
          type: "validation_error",
          code: "MISSING_CONTENT",
          message: "content is required",
        },
      })
    }

    const type =
      typeof req.body?.type === "string" && allowedTypes.has(req.body.type)
        ? req.body.type
        : "note"

    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags.filter((tag) => typeof tag === "string" && tag.trim().length > 0)
      : []

    const { client, scope } = createMemoriesClient({
      tenantId: req.body?.tenantId,
      userId: req.body?.userId,
      projectId: req.body?.projectId,
    })

    const result = await client.memories.add({
      content,
      type,
      tags,
      projectId: scope.projectId,
    })

    res.status(201).json({ ok: true, result })
  } catch (error) {
    const payload = toErrorPayload(error)
    res.status(payload.status).json(payload.body)
  }
})

app.get("/memories/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? req.query.query ?? "").trim()
    if (!q) {
      return res.status(400).json({
        ok: false,
        error: {
          type: "validation_error",
          code: "MISSING_QUERY",
          message: "q (or query) is required",
        },
      })
    }

    const limit = Number.isFinite(Number(req.query.limit))
      ? Math.max(1, Math.min(50, Math.floor(Number(req.query.limit))))
      : undefined

    const type = typeof req.query.type === "string" && allowedTypes.has(req.query.type)
      ? req.query.type
      : undefined

    const layer = typeof req.query.layer === "string" && allowedLayers.has(req.query.layer)
      ? req.query.layer
      : undefined

    const { client, scope } = createMemoriesClient({
      tenantId: req.query.tenantId,
      userId: req.query.userId,
      projectId: req.query.projectId,
    })

    const memories = await client.memories.search(q, {
      type,
      layer,
      limit,
      projectId: scope.projectId,
    })

    res.json({ ok: true, count: memories.length, memories })
  } catch (error) {
    const payload = toErrorPayload(error)
    res.status(payload.status).json(payload.body)
  }
})

app.get("/context", async (req, res) => {
  try {
    const q = String(req.query.q ?? req.query.query ?? "").trim()
    if (!q) {
      return res.status(400).json({
        ok: false,
        error: {
          type: "validation_error",
          code: "MISSING_QUERY",
          message: "q (or query) is required",
        },
      })
    }

    const mode = typeof req.query.mode === "string" && allowedModes.has(req.query.mode)
      ? req.query.mode
      : "all"

    const strategy = typeof req.query.strategy === "string" && allowedStrategies.has(req.query.strategy)
      ? req.query.strategy
      : "baseline"

    const limit = Number.isFinite(Number(req.query.limit))
      ? Math.max(1, Math.min(50, Math.floor(Number(req.query.limit))))
      : 8

    const graphDepth = req.query.graphDepth === "0" || req.query.graphDepth === "1" || req.query.graphDepth === "2"
      ? Number(req.query.graphDepth)
      : 1

    const graphLimit = Number.isFinite(Number(req.query.graphLimit))
      ? Math.max(1, Math.min(50, Math.floor(Number(req.query.graphLimit))))
      : 8

    const { client, scope } = createMemoriesClient({
      tenantId: req.query.tenantId,
      userId: req.query.userId,
      projectId: req.query.projectId,
    })

    const context = await client.context.get({
      query: q,
      mode,
      strategy,
      limit,
      graphDepth,
      graphLimit,
      projectId: scope.projectId,
    })

    res.json({
      ok: true,
      rules: context.rules,
      memories: context.memories,
      trace: context.trace,
    })
  } catch (error) {
    const payload = toErrorPayload(error)
    res.status(payload.status).json(payload.body)
  }
})

app.listen(port, () => {
  console.log(`memories-express-starter listening on http://localhost:${port}`)
})
