# Security tests, 2026-09-19

The first dated results for Meta's Data Protection Assessment, questions
3.1-12.a (software), 3.1-12.b (backend) and 3.1-12.c (cloud configuration).
From now on `.github/workflows/security.yml` repeats the software tests on every
push and the live scan weekly; each run's full report is a CI artifact.

## Static analysis: Semgrep 1.177.0

Rulesets: `p/typescript`, `p/javascript`, `p/react`, `p/secrets`,
`p/nodejsscan`, over `src`, `netlify`, `functions`, `worker-cron`, `supabase`.

| Finding | Where | Verdict |
|---|---|---|
| `gcm-no-tag-length` (ERROR) | `_lib.ts`, token decryption | **Real. Fixed.** AES-GCM decryption did not fix the tag length, so Node accepted a tag as short as 4 bytes. Now 16 bytes are required on both sides. A test forges a genuine 4-byte tag and must be refused; a mutation proves the test catches the old code |
| `node_secret` (ERROR) | `_lib.ts`, `encKey()` | False positive: it flags the environment variable's *name*. The value is read from the environment and fails closed if absent. Suppressed on that line with the reason |
| `node_insecure_random_generator` (WARNING) | `_lib.ts`, Graph API retry | Not security-relevant: jitter on a retry delay |
| `node_insecure_random_generator` (WARNING) | `demoData.ts` | Not security-relevant: ids for sample goals in the demo |

## Dependencies: npm audit

Production dependencies: **0 vulnerabilities** at any severity.

## Cloud configuration: Supabase security advisor

`supabase db advisors --linked --type security`, against the live project.

| Finding | Verdict |
|---|---|
| `function_search_path_mutable`, `audit_log_guard` and `audit_log_no_truncate` | **Real, and ours from the same day. Fixed** by migration 0024: search path pinned |
| `anon_security_definer_function_executable`, `owns_account` | **Real. Fixed** by 0024: the anonymous key can no longer call it (verified: `42501 permission denied`) |
| `authenticated_security_definer_function_executable`, `owns_account` | **Accepted.** The read policies on three tables call it, so signed-in users must be able to; it only tells a caller whether an account id is theirs |
| `auth_leaked_password_protection` | Owner setting: Supabase Auth's check of new passwords against known breaches. Turn on in the Supabase dashboard if the plan allows it |

Five findings before, two after, both accounted for.

## TLS

Measured the same day: TLS 1.2 accepted; TLS 1.0 and 1.1 refused by the
server (`alert protocol version`). See `META-DPA-DRAFT.md`.

## Live passive scan: OWASP ZAP baseline (action v0.15.0)

First run: `security.yml` run 35412269234, 2026-09-19, against
`https://app.theoffice.it.com`. **No high-risk findings.**

| Risk | Finding | Verdict |
|---|---|---|
| Medium | CSP: wildcard directive (`img-src ... https:`) | **Fixed.** The app renders no external image, so `img-src 'self' data:` |
| Medium | CSP: `style-src 'unsafe-inline'` | **Fixed.** Not needed: React sets styles through the DOM. Proven with zero violations across every page, and a broken-policy control (128 violations) |
| Medium | Cross-domain: `Access-Control-Allow-Origin: *` | **Fixed.** Cloudflare's default, detached in `_headers`; nothing reads this site cross-origin |
| Low | Cross-Origin-Opener-Policy missing | **Fixed.** `same-origin`; sign-in is by redirect, never popup |
| Low | Cross-Origin-Embedder-Policy missing | Accepted: `require-corp` gains nothing for this app and would block any future third-party asset without a CORP header |
| Low | Timestamp disclosure | Accepted: build-time numbers in bundled assets, no information of value |
| Info | Caching and "modern web app" notes | No action |

The next weekly run should show the three mediums gone; record it here.
