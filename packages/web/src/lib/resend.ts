import { Resend } from "resend"
import { getTeamInviteExpiryLabel } from "./team-invites"

let resend: Resend | null = null

export function getResend(): Resend {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set")
    }
    resend = new Resend(process.env.RESEND_API_KEY)
  }
  return resend
}

export async function sendTeamInviteEmail({
  to,
  inviterName,
  orgName,
  inviteUrl,
  role,
}: {
  to: string
  inviterName: string
  orgName: string
  inviteUrl: string
  role: string
}): Promise<void> {
  const resend = getResend()
  const inviteExpiryLabel = getTeamInviteExpiryLabel()

  const fromEmail = process.env.RESEND_FROM_EMAIL || "memories.sh <team@memories.sh>"
  
  await resend.emails.send({
    from: fromEmail,
    to,
    subject: `You've been invited to join ${orgName} on memories.sh`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a; color: #fafafa; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 32px;">
      <img src="https://memories.sh/memories.svg" alt="memories.sh" width="40" height="40" style="filter: invert(1);">
    </div>
    
    <div style="background-color: #171717; border: 1px solid #262626; padding: 32px;">
      <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">
        Join ${orgName}
      </h1>
      
      <p style="color: #a3a3a3; margin: 0 0 24px; line-height: 1.6;">
        <strong style="color: #fafafa;">${inviterName}</strong> has invited you to join 
        <strong style="color: #fafafa;">${orgName}</strong> on memories.sh as a 
        <strong style="color: #fafafa;">${role}</strong>.
      </p>
      
      <p style="color: #a3a3a3; margin: 0 0 24px; line-height: 1.6;">
        memories.sh helps teams share rules and context across AI coding tools like Cursor, Claude Code, and Copilot.
      </p>
      
      <a href="${inviteUrl}" style="display: block; background-color: #fafafa; color: #0a0a0a; text-decoration: none; padding: 14px 24px; text-align: center; font-weight: 600; font-size: 14px;">
        Accept Invite
      </a>
      
      <p style="color: #525252; font-size: 12px; margin: 24px 0 0; line-height: 1.6;">
        This invite expires in ${inviteExpiryLabel}. If you didn't expect this invite, you can ignore this email.
      </p>
    </div>
    
    <p style="color: #525252; font-size: 12px; text-align: center; margin-top: 24px;">
      memories.sh — Memory layer for AI coding agents
    </p>
  </div>
</body>
</html>
    `,
    text: `
You've been invited to join ${orgName} on memories.sh

${inviterName} has invited you to join ${orgName} as a ${role}.

memories.sh helps teams share rules and context across AI coding tools like Cursor, Claude Code, and Copilot.

Accept your invite: ${inviteUrl}

This invite expires in ${inviteExpiryLabel}.
    `.trim(),
  })
}
