"use client"

import { useState } from "react"
import { toast } from "sonner"
import { ChevronDown } from "lucide-react"

// Match CLI embedding models
const EMBEDDING_MODELS = [
  {
    id: "all-MiniLM-L6-v2",
    name: "MiniLM L6 v2",
    dimensions: 384,
    description: "Fastest model, good for most use cases",
    speed: "fast",
    quality: "good",
  },
  {
    id: "gte-small",
    name: "GTE Small",
    dimensions: 384,
    description: "Small GTE model, fast with good quality",
    speed: "fast",
    quality: "good",
  },
  {
    id: "gte-base",
    name: "GTE Base",
    dimensions: 768,
    description: "Balanced speed and quality",
    speed: "medium",
    quality: "better",
  },
  {
    id: "gte-large",
    name: "GTE Large",
    dimensions: 1024,
    description: "Highest quality, slower",
    speed: "slow",
    quality: "best",
  },
  {
    id: "mxbai-embed-large-v1",
    name: "MixedBread Large",
    dimensions: 1024,
    description: "High quality mixedbread model",
    speed: "slow",
    quality: "best",
  },
] as const

type SpeedLabel = "fast" | "medium" | "slow"
type QualityLabel = "good" | "better" | "best"

const SPEED_COLORS: Record<SpeedLabel, string> = {
  fast: "text-green-400",
  medium: "text-amber-400",
  slow: "text-red-400",
}

const QUALITY_COLORS: Record<QualityLabel, string> = {
  good: "text-blue-400",
  better: "text-purple-400",
  best: "text-primary",
}

interface SettingsFormProps {
  profile: {
    name: string
    email: string
    avatar_url: string
    plan: string
    embedding_model: string | null
  }
}

export function SettingsForm({ profile }: SettingsFormProps) {
  const [name, setName] = useState(profile.name)
  const [embeddingModel, setEmbeddingModel] = useState(
    profile.embedding_model || "all-MiniLM-L6-v2"
  )
  const [saving, setSaving] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showDimensionWarning, setShowDimensionWarning] = useState(false)

  const currentModel = EMBEDDING_MODELS.find((m) => m.id === embeddingModel)
  const originalModel = EMBEDDING_MODELS.find(
    (m) => m.id === (profile.embedding_model || "all-MiniLM-L6-v2")
  )

  function handleModelSelect(modelId: string) {
    const newModel = EMBEDDING_MODELS.find((m) => m.id === modelId)
    const oldModel = EMBEDDING_MODELS.find(
      (m) => m.id === (profile.embedding_model || "all-MiniLM-L6-v2")
    )

    // Check if dimensions are different
    if (newModel && oldModel && newModel.dimensions !== oldModel.dimensions) {
      setShowDimensionWarning(true)
    } else {
      setShowDimensionWarning(false)
    }

    setEmbeddingModel(modelId)
    setShowModelDropdown(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, embedding_model: embeddingModel }),
      })

      if (!res.ok) {
        throw new Error("Failed to save")
      }

      // Reset warning since it's now saved
      setShowDimensionWarning(false)
      toast.success("Settings saved")
    } catch (error) {
      console.error("Settings save error:", error)
      toast.error("Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    name !== profile.name ||
    embeddingModel !== (profile.embedding_model || "all-MiniLM-L6-v2")

  return (
    <div className="space-y-8 max-w-xl">
      {/* Profile section */}
      <div className="border border-border bg-card/20 p-6 space-y-6">
        <h2 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
          Profile
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 bg-background border border-border text-sm focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2">
              Email
            </label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full px-4 py-3 bg-muted/30 border border-border text-sm text-muted-foreground"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2">
              Plan
            </label>
            <div className="px-4 py-3 bg-muted/30 border border-border text-sm">
              <span className="uppercase tracking-wider font-bold">{profile.plan}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Embedding Model section */}
      <div className="border border-border bg-card/20 p-6 space-y-6">
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
            Embedding Model
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            The model used to generate semantic embeddings for your memories
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            className="w-full px-4 py-3 bg-background border border-border text-sm focus:border-primary/50 focus:outline-none transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="font-medium">{currentModel?.name || embeddingModel}</span>
              <span className="text-xs text-muted-foreground">
                {currentModel?.dimensions}d
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>

          {showModelDropdown && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowModelDropdown(false)}
              />
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border shadow-lg z-20 max-h-[300px] overflow-y-auto">
                {EMBEDDING_MODELS.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => handleModelSelect(model.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors ${
                      embeddingModel === model.id ? "bg-muted/30" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{model.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] uppercase ${SPEED_COLORS[model.speed]}`}>
                          {model.speed}
                        </span>
                        <span className={`text-[10px] uppercase ${QUALITY_COLORS[model.quality]}`}>
                          {model.quality}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {model.dimensions}d
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {model.description}
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Dimension change warning */}
        {showDimensionWarning && originalModel && currentModel && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-sm">
            <p className="text-amber-400 font-medium mb-1">Dimension Change Warning</p>
            <p className="text-muted-foreground text-xs">
              Switching from {originalModel.dimensions}d to {currentModel.dimensions}d will
              require re-embedding your existing memories. Run{" "}
              <code className="px-1 py-0.5 bg-muted text-foreground">memories embed --all</code>{" "}
              after saving to regenerate embeddings.
            </p>
          </div>
        )}

        {/* Model info */}
        {currentModel && (
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 bg-muted/30 border border-border">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Speed
              </p>
              <p className={`text-sm font-bold uppercase ${SPEED_COLORS[currentModel.speed]}`}>
                {currentModel.speed}
              </p>
            </div>
            <div className="p-3 bg-muted/30 border border-border">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Quality
              </p>
              <p className={`text-sm font-bold uppercase ${QUALITY_COLORS[currentModel.quality]}`}>
                {currentModel.quality}
              </p>
            </div>
            <div className="p-3 bg-muted/30 border border-border">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Dimensions
              </p>
              <p className="text-sm font-bold font-mono">{currentModel.dimensions}</p>
            </div>
          </div>
        )}
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || !hasChanges}
        className="px-8 py-3 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-[0.15em] hover:opacity-90 transition-all duration-300 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>

      {/* Sign out */}
      <div className="border-t border-border pt-8">
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="px-8 py-3 bg-muted/50 text-foreground border border-border text-xs font-bold uppercase tracking-[0.15em] hover:bg-muted transition-all duration-300"
          >
            Sign Out
          </button>
        </form>
      </div>
    </div>
  )
}
