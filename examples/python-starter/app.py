from __future__ import annotations

import os
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="memories-python-starter", version="0.0.1")


def _required_env(name: str) -> str:
  value = os.getenv(name, "").strip()
  if not value:
    raise HTTPException(
      status_code=500,
      detail={
        "ok": False,
        "error": {
          "type": "validation_error",
          "code": "MISSING_ENV",
          "message": f"Missing environment variable: {name}",
        },
      },
    )
  return value


def _optional(value: str | None) -> str | None:
  if value is None:
    return None
  trimmed = value.strip()
  return trimmed or None


def _scope(tenant_id: str | None, user_id: str | None, project_id: str | None) -> dict[str, str]:
  resolved_tenant = _optional(tenant_id) or _optional(os.getenv("MEMORIES_TENANT_ID"))
  resolved_user = _optional(user_id) or _optional(os.getenv("MEMORIES_USER_ID"))
  resolved_project = _optional(project_id) or _optional(os.getenv("MEMORIES_PROJECT_ID"))

  scope: dict[str, str] = {}
  if resolved_tenant:
    scope["tenantId"] = resolved_tenant
  if resolved_user:
    scope["userId"] = resolved_user
  if resolved_project:
    scope["projectId"] = resolved_project
  return scope


def _base_url() -> str:
  return _optional(os.getenv("MEMORIES_BASE_URL")) or "https://memories.sh"


async def _sdk_post(endpoint: str, payload: dict[str, Any]) -> Any:
  api_key = _required_env("MEMORIES_API_KEY")
  url = f"{_base_url().rstrip('/')}{endpoint}"
  headers = {
    "authorization": f"Bearer {api_key}",
    "content-type": "application/json",
  }

  try:
    async with httpx.AsyncClient(timeout=20.0) as client:
      response = await client.post(url, json=payload, headers=headers)
  except httpx.HTTPError as exc:
    raise HTTPException(
      status_code=502,
      detail={
        "ok": False,
        "error": {
          "type": "network_error",
          "code": "UPSTREAM_REQUEST_FAILED",
          "message": str(exc),
        },
      },
    ) from exc

  try:
    data = response.json()
  except ValueError as exc:
    raise HTTPException(
      status_code=502,
      detail={
        "ok": False,
        "error": {
          "type": "http_error",
          "code": "INVALID_JSON",
          "message": "Upstream returned non-JSON response",
        },
      },
    ) from exc

  if isinstance(data, dict) and "ok" in data and "data" in data:
    if not data.get("ok", False):
      error = data.get("error") or {
        "type": "http_error",
        "code": "UPSTREAM_ERROR",
        "message": "Unknown upstream error",
      }
      raise HTTPException(status_code=response.status_code, detail={"ok": False, "error": error})
    return data.get("data")

  if response.status_code >= 400:
    raise HTTPException(
      status_code=response.status_code,
      detail={
        "ok": False,
        "error": {
          "type": "http_error",
          "code": f"HTTP_{response.status_code}",
          "message": "Upstream request failed",
          "details": data,
        },
      },
    )

  return data


class AddMemoryRequest(BaseModel):
  content: str = Field(min_length=1)
  type: Literal["rule", "decision", "fact", "note", "skill"] = "note"
  tags: list[str] = Field(default_factory=list)
  tenantId: str | None = None
  userId: str | None = None
  projectId: str | None = None


@app.get("/health")
async def health() -> dict[str, Any]:
  return {
    "ok": True,
    "service": "memories-python-starter",
    "baseUrl": _base_url(),
  }


@app.post("/memories/add")
async def add_memory(payload: AddMemoryRequest) -> dict[str, Any]:
  scope = _scope(payload.tenantId, payload.userId, payload.projectId)
  body = {
    "content": payload.content.strip(),
    "type": payload.type,
    "tags": [tag.strip() for tag in payload.tags if tag.strip()],
    "scope": scope or None,
  }
  result = await _sdk_post("/api/sdk/v1/memories/add", body)
  return {"ok": True, "result": result}


@app.get("/memories/search")
async def search_memories(
  q: str = Query(..., min_length=1),
  limit: int = Query(8, ge=1, le=50),
  type: Literal["rule", "decision", "fact", "note", "skill"] | None = None,
  layer: Literal["rule", "working", "long_term"] | None = None,
  tenantId: str | None = None,
  userId: str | None = None,
  projectId: str | None = None,
) -> dict[str, Any]:
  scope = _scope(tenantId, userId, projectId)
  body: dict[str, Any] = {
    "query": q,
    "limit": limit,
    "scope": scope or None,
  }
  if type:
    body["type"] = type
  if layer:
    body["layer"] = layer

  result = await _sdk_post("/api/sdk/v1/memories/search", body)
  memories = result.get("memories", []) if isinstance(result, dict) else []
  return {"ok": True, "count": len(memories), "memories": memories}


@app.get("/context")
async def get_context(
  q: str = Query(..., min_length=1),
  mode: Literal["all", "working", "long_term", "rules_only"] = "all",
  strategy: Literal["baseline", "hybrid_graph"] = "baseline",
  limit: int = Query(8, ge=1, le=50),
  graphDepth: Literal[0, 1, 2] = 1,
  graphLimit: int = Query(8, ge=1, le=50),
  tenantId: str | None = None,
  userId: str | None = None,
  projectId: str | None = None,
) -> dict[str, Any]:
  scope = _scope(tenantId, userId, projectId)
  body = {
    "query": q,
    "mode": mode,
    "strategy": strategy,
    "limit": limit,
    "graphDepth": graphDepth,
    "graphLimit": graphLimit,
    "scope": scope or None,
  }

  result = await _sdk_post("/api/sdk/v1/context/get", body)
  rules = result.get("rules", []) if isinstance(result, dict) else []
  memories = result.get("memories", []) if isinstance(result, dict) else []
  trace = result.get("trace") if isinstance(result, dict) else None

  return {
    "ok": True,
    "rules": rules,
    "memories": memories,
    "trace": trace,
  }
