-- Harden invite + organization slug uniqueness guarantees used by API race handling.

-- Normalize invite email casing before applying uniqueness constraints.
UPDATE public.org_invites
SET email = lower(trim(email))
WHERE email IS NOT NULL
  AND email <> lower(trim(email));

-- Keep only the newest unresolved invite per org/email so the partial unique index can be created safely.
WITH ranked_unaccepted AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY org_id, lower(email)
      ORDER BY expires_at DESC, created_at DESC, id DESC
    ) AS rank
  FROM public.org_invites
  WHERE accepted_at IS NULL
)
DELETE FROM public.org_invites invites
USING ranked_unaccepted ranked
WHERE invites.id = ranked.id
  AND ranked.rank > 1;

-- At most one unresolved invite per organization/email.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invites_pending_org_email_unique
  ON public.org_invites (org_id, lower(email))
  WHERE accepted_at IS NULL;

-- Guarantee stable slug uniqueness for conflict-safe organization creation retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug_unique
  ON public.organizations (slug);
