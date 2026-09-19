# TikTok: how we work around Jordan's block, and what gets built

Started 2026-09-19. Decision by the operator: **TikTok support is for Jordanian
creators, who already reach TikTok through a VPN.**

TikTok has been blocked in Jordan since December 2022. It is not a detail of
the integration; it touches four separate places, and only one of them is the
client's VPN.

---

## 1. What was measured on 2026-09-19

| From | Target | Result |
|---|---|---|
| This Mac, Amman (Zain, AS48832) | `tiktok.com`, `developers.tiktok.com`, `open.tiktokapis.com` | **Time out** at connect / TLS |
| This Mac, Amman | `developers.facebook.com`, `learn.microsoft.com`, a ByteDance commerce domain | Answer normally (the controls) |
| **Cloudflare, Amman data centre (`colo=AMM`)** | `open.tiktokapis.com/v2/user/info/` | **Answers: `401 access_token_invalid`**, a genuine TikTok response, 1.3 s |
| Cloudflare AMM | `www.tiktok.com/robots.txt` | 200 |

Method: a throwaway Worker (no secrets, no data) deployed, called once from
Amman, and deleted. It proved the colo was AMM (`request.cf.colo`), which is
the location that serves every Jordanian client of `app.theoffice.it.com`.

**The block is at Jordanian ISPs. Cloudflare's network is not behind it.**
Our servers reach TikTok even when the request comes from Jordan.

Also recorded, because it is a first-hand primary observation the sync needs:
TikTok's answer to a bad token is **HTTP 401 with
`{"error":{"code":"access_token_invalid", ...}}`**.

## 2. The four places the block matters

**a. Our servers calling TikTok: no problem (measured above).** The OAuth
callback, the scheduled sync, the manual sync and Check now all run on
Cloudflare. If this ever changes, the alerting item in `tasks.md` is what would
notice.

**b. A client connecting: needs their VPN on, for that step only.** Connecting
opens TikTok's consent page in the client's own browser, and that page is
blocked in Jordan. After that, every call is server-to-server, including the
token refresh, so the VPN is not needed again until they reconnect. The
Connections page must say so BEFORE sending them to TikTok: a failure on
TikTok's page happens outside our app, where we cannot catch it or explain it.
(Token lifetimes, and so how often "reconnect" comes round, are to be read
from TikTok's docs, not assumed.)

**c. A client viewing the dashboard: must not need a VPN, so nothing may load
from TikTok's domains.** A cover image or avatar hot-linked from TikTok's CDN
would be a broken image for every Jordanian viewer without a VPN. "Open on
TikTok" links will not open for them either and must be labelled as needing
TikTok access. First version: no TikTok thumbnails.

**d. Us building it: TikTok's docs are unreachable from this Mac.** This
project builds from the platform's own documentation (the LinkedIn plan had
four defects that only the primary pages caught). Options, in order:
1. A VPN on this Mac for TikTok work sessions. Simplest, and it is also what
   testing the connect flow ourselves needs.
2. Nothing else is proposed. Relaying the docs through our own Cloudflare
   account would work technically but turns our infrastructure into a way
   round the block for anyone who found it.

## 3. What exists today, and why it is a rebuild

`syncTiktok` in `_sync.ts`, `oauth-tiktok*.ts` and the refresh in `_tokens.ts`
were written against secondary sources and have never run against a real
account. Read on 2026-09-19, the sync breaks this project's own first rules:

- every figure is `?? 0`, the invariant CLAUDE.md lists first;
- `saves: 0` for a metric the Display API does not report, and
  `reach = view_count`, reach invented from views (the LinkedIn version of
  that has its own mutation);
- `.catch(() => ({ data: { videos: [] } }))` on the video list swallows every
  error, including an expired token;
- one page of 20 videos, no cursor;
- a video with no `create_time` is filed under today;
- TikTok errors are plain `Error`s, so `isAuthError` cannot recognise an
  expired token and the account would never be flagged for reconnection.

**Fixed 2026-09-19, without the docs** (these break our own rules whatever
TikTok says): figures are null when absent, never 0; saves and reach are null
rather than invented; the video list's errors propagate; a video without a
creation time is skipped; and TikTok errors are classified on liGet's
convention (a dead token as code 190, a throttle as 4), using the 401
`access_token_invalid` we observed first-hand. Four tests, five mutations.
**Still unverified and unchanged:** every endpoint, field name and limit, and
paging (one page of 20). That is the rebuild, after the docs are read.

## 4. Which API, to be settled from the primary docs

- **Display API** (Login Kit + `user.info.stats`, `video.list`): works for any
  account; lifetime totals only. Followers, and per-video views, likes,
  comments, shares. No reach, no daily history, no audience.
- **Business API** (TikTok API for Business, business accounts): daily account
  metrics, profile views, audience demographics, per-video reach and watch
  time. Much closer to what Instagram clients get.

Both need a developer app and TikTok's review before strangers can connect,
and both have a sandbox for testing with our own accounts first. Which one,
or both with Display as the fallback for non-business accounts, is decided
once the docs are read.

## 5. Order of work

1. VPN on; read the primary docs for both APIs; write the verified endpoint,
   field and limit list here, with dates, as was done for LinkedIn.
2. Rebuild the sync against it, test-first with a strict mock, keeping every
   Instagram invariant (null not zero, no swallowed auth or throttle errors,
   paging, classified errors).
3. Connect-page copy for the VPN step, and no TikTok-hosted media anywhere in
   the dashboard.
4. Create the TikTok developer app (the operator, on a VPN), sandbox-test with
   our own accounts, then TikTok's review.

One thing worth knowing, stated once and not a gate: the feature works for
Jordanian clients only because they route around a national block. That is
already how they use TikTok itself.
