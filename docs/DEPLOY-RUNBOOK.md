# Deploy runbook — zero to a pilot client on real data

Follow in order. Steps 1 and 2 run in parallel with everything else; start them
first. Times are working estimates.

---

## 0. Prerequisites (15 min)

- A Supabase project. **Choose the region deliberately** — for Jordanian clients
  this is a PDPL data-residency decision, not just latency.
- A Netlify site connected to this repo.
- A Meta developer app.

## 1. Start Business Verification — do this FIRST (2–5 business days, waiting)

See [`SETUP-META.md`](SETUP-META.md) §1. It is free, it blocks Advanced Access,
and nothing you do in code shortens it. If your commercial registration needs a
stamped English translation, order it today — that is the step most likely to
add days.

## 2. Configure the Meta app (45 min)

[`SETUP-META.md`](SETUP-META.md) §2. In short:

- Products → Instagram → **API setup with Instagram login**
- Redirect URI: `https://YOUR-SITE/api/oauth-instagram-callback`
- Permissions: `instagram_business_basic`, `instagram_business_manage_insights` — nothing else
- App settings → Advanced → **Require App Secret: ON**
- App settings → Basic → set all four URLs:
  - Privacy `https://YOUR-SITE/privacy`
  - Terms `https://YOUR-SITE/terms`
  - Data deletion callback `https://YOUR-SITE/api/meta-data-deletion`
  - Deauthorize callback `https://YOUR-SITE/api/meta-deauthorize`

## 3. Database (20 min)

In the Supabase SQL editor, run in this exact order:

1. `supabase/schema.sql`
2. `supabase/migrations/0001_audit_fixes.sql`
3. `supabase/migrations/0002_token_refresh.sql`
4. `supabase/migrations/0003_deletion_and_consent.sql`
5. `supabase/migrations/0004_ai_usage.sql`
6. `supabase/migrations/0005_instagram_login.sql`

Then **Project settings → API → Exposed schemas**: add `pulseboard`, keep
`public` and `graphql_public`. Without this every request returns PGRST106.

**Record which migrations you have applied.** Re-running `schema.sql` after an
edit does nothing — every statement in it is `create table if not exists`, so a
later change silently does not happen.

## 4. Secrets (15 min)

Generate:

```bash
node -e "console.log('TOKEN_ENC_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('OAUTH_STATE_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Set in **Netlify → Site configuration → Environment variables**, and scope them
to the **Production** context only:

| Variable | Notes |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | frontend |
| `VITE_SITE_URL` | e.g. `https://pulseboard.netlify.app` |
| `SUPABASE_SERVICE_ROLE_KEY` | secret |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | Instagram Login path |
| `META_APP_ID` / `META_APP_SECRET` | only if connecting Facebook Pages |
| `TOKEN_ENC_KEY` / `OAUTH_STATE_SECRET` | both fail closed if missing |
| `ANTHROPIC_API_KEY` | optional; the assistant degrades gracefully without it |

Scoping to Production matters: Netlify env vars are global by default, and the
code now **refuses** to run in a deploy-preview context against these
credentials rather than letting a preview touch live client data.

## 5. Deploy (10 min)

Push to `main`. Netlify builds (`npm run build`, publish `dist`). Confirm:

- `https://YOUR-SITE/privacy`, `/terms`, `/data-deletion` all load
- `https://YOUR-SITE/api/deletion-status?code=x` returns JSON, not HTML

## 6. Connect your OWN Instagram account (20 min)

Sign up in the app, go to Connections, tick the consent box, connect Instagram.
You are an app admin, so this works in Development Mode.

Then run a sync and wait. **Let it run for at least three days** before judging
the numbers — recent days are provisional by design and will read low.

## 7. Reconcile — the gate that matters (30 min, after 3+ days of syncing)

```bash
export VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
node verify/reconcile.mjs --list
node verify/reconcile.mjs --account <id> --days 14
```

Compare three or four **settled** (non-provisional) days against the Instagram
app, one day at a time. The script prints exactly what to compare and what each
kind of mismatch means.

**Do not put this in front of a client until the numbers agree.** This is the
only validation that exists: everything else was tested against a mock built
from documentation, not from live responses.

## 8. Pilot client via Tester role (30 min)

App dashboard → App roles → Roles → add the client's Instagram account as a
**Tester**. They accept the invitation from their own Instagram settings. They
can then connect through your app and see real data, with no App Review.

This is for pilots, not the business — see [`PROJECT-STATE.md`](PROJECT-STATE.md).

## 9. App Review (after step 7, weeks of waiting)

Record the screencast now that real data appears, and submit. See
[`SETUP-META.md`](SETUP-META.md) §4.

---

## If something breaks

| Symptom | Cause |
|---|---|
| Every request 500s, logs say "not configured" | `TOKEN_ENC_KEY` or `OAUTH_STATE_SECRET` unset — deliberate |
| `PGRST106` | `pulseboard` not in Exposed schemas |
| `PGRST204` | A migration was not applied |
| OAuth returns `bad_state` | Cookie blocked, or more than 5 minutes elapsed |
| OAuth returns `already_connected_elsewhere` | That account belongs to another tenant |
| Dashboard empty after sync | Check `sync_log`; a failed run records `error_code` |
| Numbers off by exactly one day | `dayKeyFromEndTime` — see `docs/DATA-INTEGRITY.md` D2 |
