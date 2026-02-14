"use client"

import React, { FormEvent, useState } from "react"

type Interest = "enterprise" | "usage_based" | "both"

interface FormState {
  name: string
  workEmail: string
  company: string
  teamSize: string
  interest: Interest
  useCase: string
  hp: string
}

const initialState: FormState = {
  name: "",
  workEmail: "",
  company: "",
  teamSize: "",
  interest: "both",
  useCase: "",
  hp: "",
}

const inputClassName =
  "w-full border border-border bg-card/30 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50"

export function EnterpriseContactForm(): React.JSX.Element {
  const [form, setForm] = useState<FormState>(initialState)
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [message, setMessage] = useState<string>("")

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus("submitting")
    setMessage("")

    try {
      const response = await fetch("/api/enterprise/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string
        error?: string
      }

      if (!response.ok) {
        setStatus("error")
        setMessage(payload.error || "Could not submit the form. Please try again.")
        return
      }

      setStatus("success")
      setMessage(payload.message || "Thanks. We received your request and will follow up shortly.")
      setForm(initialState)
    } catch {
      setStatus("error")
      setMessage("Network error. Please try again or email hello@memories.sh.")
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground">Name</span>
          <input
            required
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            className={inputClassName}
            placeholder="Jane Doe"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground">Work Email</span>
          <input
            required
            type="email"
            value={form.workEmail}
            onChange={(event) => setForm((prev) => ({ ...prev, workEmail: event.target.value }))}
            className={inputClassName}
            placeholder="jane@company.com"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="space-y-2 md:col-span-2">
          <span className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground">Company</span>
          <input
            required
            value={form.company}
            onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))}
            className={inputClassName}
            placeholder="Acme, Inc."
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground">Team Size</span>
          <input
            required
            value={form.teamSize}
            onChange={(event) => setForm((prev) => ({ ...prev, teamSize: event.target.value }))}
            className={inputClassName}
            placeholder="15 engineers"
          />
        </label>
      </div>

      <label className="space-y-2">
        <span className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground">I am interested in</span>
        <select
          value={form.interest}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, interest: event.target.value as Interest }))
          }
          className={inputClassName}
        >
          <option value="both">Enterprise + usage-based SaaS plan</option>
          <option value="usage_based">Usage-based SaaS developer plan</option>
          <option value="enterprise">Enterprise support and contracts</option>
        </select>
      </label>

      <label className="space-y-2">
        <span className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground">Use Case</span>
        <textarea
          required
          value={form.useCase}
          onChange={(event) => setForm((prev) => ({ ...prev, useCase: event.target.value }))}
          className={`${inputClassName} min-h-[150px] resize-y`}
          placeholder="Tell us what you're building, expected API volume, and what pricing model would help you get started."
        />
      </label>

      <input
        value={form.hp}
        onChange={(event) => setForm((prev) => ({ ...prev, hp: event.target.value }))}
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        name="website"
        aria-hidden="true"
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
        <button
          type="submit"
          disabled={status === "submitting"}
          className="px-6 py-3 text-xs font-bold uppercase tracking-[0.2em] bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {status === "submitting" ? "Submitting..." : "Submit Request"}
        </button>

        <p className="text-xs text-muted-foreground">
          Replies go to <span className="text-foreground">hello@memories.sh</span>
        </p>
      </div>

      {status === "success" && (
        <p className="text-sm text-emerald-400">{message}</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-400">{message}</p>
      )}
    </form>
  )
}
