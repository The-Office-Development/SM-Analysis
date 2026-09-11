# Connecting a client's Instagram — the guide that was missing

For a pilot client joining while the app is in Development Mode, which is how
drinkat starts. **Read [`DEPLOY-RUNBOOK.md`](DEPLOY-RUNBOOK.md) §8 first** — that
section explains why this is a temporary arrangement rather than the launch
route, and the distinction matters before you sit down with anybody.

The existing material does not cover this. `setupGuides.instagram` inside the app
is written for the OPERATOR configuring a Meta app, and a client should never see
it. `CLIENT-MESSAGE.md` is addressed to a different client about test-account
access. Neither says how a person connects their own account.

---

## Before the meeting

- [ ] **Their account must already be Business or Creator.** A personal account
      exposes no insights at all, and switching is done on their phone, not by
      us: Settings → Account type and tools → Switch to professional account.
      Switching is reversible and does not change their existing posts.
- [ ] **They need a DESKTOP or laptop to accept the invitation.** This is the
      thing that wastes a meeting. The tester invite does **not** appear in the
      Instagram mobile app at all — the screen simply is not there — and everyone
      reaches for their phone first because that is where Instagram lives. It is
      accepted on `instagram.com` in a browser. Confirmed the hard way while
      connecting the first account.
      A phone is still fine for the professional-account switch above.
- [ ] **Have their Instagram handle to hand**, not their name or email. The
      invitation is addressed to the handle.

## In the meeting

**1. Invite the account as a Tester.**

App dashboard → **PulseBoard** → **App Roles → Roles → Add People → Instagram
Tester**, and enter their Instagram handle.

**2. They accept it on a computer — not on their phone.**

On `instagram.com` in a browser, signed in as that account:
**Settings → Apps and websites → Tester invites → Accept**.

This is the step that goes wrong, and it goes wrong the same way every time.
Nothing arrives by email, there is no Facebook notification, and **the mobile app
does not show tester invites at all** — the screen does not exist there, so
somebody looking on their phone concludes the invitation was never sent. Get them
on a laptop before you send it, and walk them to the page rather than describing
it.

**3. They sign in to PulseBoard and connect.**

`app.theoffice.it.com` → sign in → **Connections → Instagram → Connect**. They
authorise on Instagram's own screen. We never see their password, and the
permissions are read-only.

**4. Press Sync, then wait.**

The first sync fetches recent history; the cron continues every fifteen minutes.
Do not judge the dashboard in the first minute — a brand-new connection has
little stored, and the interpretation panels stay silent until there is enough
behind them. That silence is deliberate, not a fault.

## What to tell them, in plain words

- We read their numbers. We cannot post, reply, or message as them, and the
  permissions we ask for do not allow it.
- They can withdraw it at any moment from Instagram itself, without asking us.
- Daily figures come from Instagram's official data feed. The Instagram app
  computes its own daily numbers slightly differently, so a single day can
  differ; over a month the totals agree closely. **Say this before they notice
  it**, because they will eventually compare one day and conclude we are wrong.

## What not to promise

- **Stories.** Built, never once captured. Do not describe it as working.
- **Anything about a day-by-day match** with the Instagram app. See above.
- **Other clients joining quickly.** Tester roles cap at about five and each one
  needs this whole ceremony. That is what App Review fixes.

## If it fails

| What they see | What it means |
|---|---|
| "Insufficient developer role" | The invitation was not accepted yet, or was sent to the wrong handle |
| They cannot find the invitation | They are looking on their phone. It only appears on instagram.com in a browser |
| No insights, empty dashboard | The account is still personal, not Business or Creator |
| Consent screen with no Instagram option | They are signed into a different Instagram account in that browser |
