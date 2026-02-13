# Product Hunt Launch Day Runbook

This runbook is for launch-day execution and moderation. It is intentionally strict so we can stay compliant and convert traffic.

## 1) Compliance Rules (Non-Negotiable)

- Do not ask for upvotes directly in public posts, DMs, or emails.
- Do not offer rewards, discounts, giveaways, or access in exchange for upvotes/comments.
- Do not coordinate voting rings or ask people to create new accounts just to vote.
- Do ask for honest feedback, questions, and product discussion.
- Keep all outreach phrased as "check it out / share feedback" rather than "please vote."

## 2) Team Roles

- `Launch owner`: publishes, pins first comment, drives timeline.
- `Comment responder`: replies to Product Hunt comments within 10 minutes.
- `Support/triage`: handles bugs, signup issues, or docs confusion.
- `Social distributor`: posts to X/LinkedIn/Discord and routes feedback back into a single thread.

If one person is covering multiple roles, keep this priority order:
1. Product Hunt comments
2. Signup/support issues
3. Social distribution

## 3) Timeline (Launch Day)

1. `T-60 min`
- Verify homepage, docs, login, and API health endpoints are live.
- Open dashboards/logs for app errors and auth failures.
- Prepare first comment text and FAQ snippets.

2. `T-0`
- Publish Product Hunt post.
- Add maker first comment with concise setup steps and a request for feedback.
- Publish social posts pointing to the Product Hunt listing.

3. `T+0 to T+12h`
- Reply to every Product Hunt comment quickly.
- Track repeated objections/questions and update the first comment + docs.
- Keep support responses under 10 minutes for launch window.

4. `T+12h to T+24h`
- Post a short "what we shipped/fixed today" update in Product Hunt comments.
- Capture all requested features and launch-day bugs into backlog.

## 4) Response Standards

- First response SLA: under 10 minutes during active window.
- Tone: short, direct, technical, and specific.
- Every response should include one of:
  - exact command (`memories setup`)
  - exact doc URL
  - clear next step ("If this fails, send the command output")

## 5) Incident Playbook

1. If signup/auth fails:
- Post a temporary workaround publicly (CLI-first flow + docs link).
- Pin status update in first comment.
- Open incident issue and assign an owner immediately.

2. If docs are unclear:
- Patch docs immediately and reply with the corrected link.
- Do not wait for a larger docs batch.

3. If API degradation occurs:
- Post transparent status update.
- Route users to local/offline CLI path until restored.

## 6) Metrics To Track

- Product Hunt page views, comments, and rank progression.
- Site sessions from Product Hunt (`utm_source=producthunt`).
- `docs/getting-started` visits and completion proxy (copy/install clicks).
- Login success rate and error rate during launch window.
- "Time to first value": first successful `memories setup` or `memories add`.

## 7) End-of-Day Debrief

- What questions came up most?
- Where did users get stuck?
- Which responses converted best?
- What must be fixed before day-2 promotion?

Publish a short post-launch summary and top 3 follow-ups before ending the day.
