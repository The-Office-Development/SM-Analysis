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

## Live passive scan (OWASP ZAP baseline)

Runs in CI (`security.yml`, job `live`); there is no Docker on the build Mac.
The first run's report is the `zap-baseline-report` artifact of the workflow's
first manual run. Record its result here.
