import { NextResponse } from "next/server"
import { getResend } from "@/lib/resend"
import { checkRateLimit, getClientIp, publicRateLimit } from "@/lib/rate-limit"
import { enterpriseContactSchema, parseBody } from "@/lib/validations"
import { hasResendApiKey, getEnterpriseContactTo, getResendFromEmail } from "@/lib/env"

const CACHE_CONTROL_NO_STORE = "no-store"
const SUCCESS_MESSAGE = "Thanks. We received your request and will follow up shortly."

export async function POST(request: Request): Promise<Response> {
  const rateLimited = await checkRateLimit(publicRateLimit, getClientIp(request))
  if (rateLimited) return rateLimited

  const parsed = parseBody(enterpriseContactSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response

  const { name, workEmail, company, teamSize, interest, useCase, hp } = parsed.data

  // Honeypot for basic bot traffic; return success to avoid training spam bots.
  if (hp && hp.length > 0) {
    return NextResponse.json(
      { success: true, message: SUCCESS_MESSAGE },
      { status: 201, headers: { "Cache-Control": CACHE_CONTROL_NO_STORE } }
    )
  }

  const resendConfigured = hasResendApiKey()
  const to = getEnterpriseContactTo()
  const from = getResendFromEmail()

  if (!resendConfigured) {
    console.warn("Enterprise contact submitted but RESEND_API_KEY is not configured", {
      name,
      workEmail,
      company,
      teamSize,
      interest,
    })
    return NextResponse.json(
      { success: true, message: SUCCESS_MESSAGE },
      { status: 201, headers: { "Cache-Control": CACHE_CONTROL_NO_STORE } }
    )
  }

  try {
    const subject = `[Enterprise Inquiry] ${company} (${interest})`
    const submittedAt = new Date().toISOString()

    await getResend().emails.send({
      from,
      to,
      replyTo: workEmail,
      subject,
      text: [
        "New enterprise inquiry",
        "",
        `Name: ${name}`,
        `Work email: ${workEmail}`,
        `Company: ${company}`,
        `Team size: ${teamSize}`,
        `Interest: ${interest}`,
        `Submitted at: ${submittedAt}`,
        "",
        "Use case:",
        useCase,
      ].join("\n"),
      html: `
<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0a0a0a; color:#fafafa; padding:24px;">
    <div style="max-width:680px; margin:0 auto; border:1px solid #262626; background:#171717; padding:24px;">
      <h1 style="margin:0 0 16px; font-size:20px;">New enterprise inquiry</h1>
      <p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p style="margin:0 0 8px;"><strong>Work email:</strong> ${escapeHtml(workEmail)}</p>
      <p style="margin:0 0 8px;"><strong>Company:</strong> ${escapeHtml(company)}</p>
      <p style="margin:0 0 8px;"><strong>Team size:</strong> ${escapeHtml(teamSize)}</p>
      <p style="margin:0 0 8px;"><strong>Interest:</strong> ${escapeHtml(interest)}</p>
      <p style="margin:0 0 16px;"><strong>Submitted at:</strong> ${escapeHtml(submittedAt)}</p>
      <hr style="border:none; border-top:1px solid #262626; margin:16px 0;" />
      <p style="margin:0 0 6px;"><strong>Use case</strong></p>
      <pre style="margin:0; white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; line-height:1.5; color:#d4d4d8;">${escapeHtml(useCase)}</pre>
    </div>
  </body>
</html>`,
    })

    return NextResponse.json(
      { success: true, message: SUCCESS_MESSAGE },
      { status: 201, headers: { "Cache-Control": CACHE_CONTROL_NO_STORE } }
    )
  } catch (error) {
    console.error("Failed to send enterprise inquiry email:", error)
    return NextResponse.json(
      { error: "Unable to submit right now. Please email hello@memories.sh." },
      { status: 500, headers: { "Cache-Control": CACHE_CONTROL_NO_STORE } }
    )
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
