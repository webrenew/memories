import { checkRateLimit, getClientIp, publicRateLimit } from "@/lib/rate-limit"
import { readFile } from "fs/promises"
import { NextRequest, NextResponse } from "next/server"
import { normalize, resolve, sep } from "path"

const CACHE_CONTROL_DOCS = "public, s-maxage=300, stale-while-revalidate=86400"
const CACHE_CONTROL_NOT_FOUND = "public, s-maxage=60, stale-while-revalidate=300"
const DOCS_ROOT = resolve(process.cwd(), "content", "docs")

function normalizeDocsPath(rawPath: string | null): string | null {
  if (!rawPath) return null

  const trimmed = rawPath.trim()
  if (!trimmed || trimmed.includes("\0")) return null

  const normalizedSlashes = trimmed.replace(/\\/g, "/")
  const withoutMdxExtension = normalizedSlashes.endsWith(".mdx")
    ? normalizedSlashes.slice(0, -4)
    : normalizedSlashes
  const collapsed = normalize(withoutMdxExtension).replace(/\\/g, "/")

  if (!collapsed || collapsed === "." || collapsed === "..") return null
  if (collapsed.startsWith("/") || collapsed.startsWith("../")) return null
  if (!/^[a-zA-Z0-9/_-]+$/.test(collapsed)) return null

  return collapsed
}

function resolveDocsFilePath(rawPath: string | null): string | null {
  const normalizedPath = normalizeDocsPath(rawPath)
  if (!normalizedPath) return null

  const candidate = resolve(DOCS_ROOT, `${normalizedPath}.mdx`)
  const docsRootPrefix = DOCS_ROOT.endsWith(sep) ? DOCS_ROOT : `${DOCS_ROOT}${sep}`
  if (!candidate.startsWith(docsRootPrefix)) {
    return null
  }

  return candidate
}

function isNotFoundError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === "ENOENT" || code === "ENOTDIR"
}

export async function GET(request: NextRequest): Promise<Response> {
  const rateLimited = await checkRateLimit(publicRateLimit, getClientIp(request))
  if (rateLimited) return rateLimited

  const filePath = resolveDocsFilePath(request.nextUrl.searchParams.get("path"))
  if (!filePath) {
    return NextResponse.json({ error: "Invalid path parameter" }, { status: 400 })
  }

  try {
    const content = await readFile(filePath, "utf-8")

    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": CACHE_CONTROL_DOCS,
      },
    })
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json(
        { error: "File not found" },
        {
          status: 404,
          headers: {
            "Cache-Control": CACHE_CONTROL_NOT_FOUND,
          },
        }
      )
    }

    console.error("Failed to read MDX file:", error)
    return NextResponse.json({ error: "Failed to load document" }, { status: 500 })
  }
}
