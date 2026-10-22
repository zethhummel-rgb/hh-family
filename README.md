# HH — private family pilot

A separate application derived from Hummel Home's code. The original GitHub repository, website, Supabase project, accounts, calendar connection and notification service are not modified. This copy contains no family accounts, events, lists, OAuth secrets, refresh tokens, or notification subscriptions.

## Current deployment

- Independent repository: https://github.com/zethhummel-rgb/hh-family
- GitHub Pages address: https://zethhummel-rgb.github.io/hh-family/
- Independent Supabase project: **HH Family**, Canada Central.
- Fresh database installed as migration `20261019152655_hh_independent_family_pilot`.
- Calendar and notification Edge Functions deployed, with HH's Pages address as their default app URL. The project has its own Vault scheduler credential. No personal Google OAuth or push credentials were copied.
- The site owner’s chosen administrator email is authorized privately in the backend. Sign up and confirm that address on HH; no account or password has been created automatically.
- `src/config.ts` includes only this new project's browser-safe publishable key, with optional build-time variable overrides. Database access is enforced by RLS. The original Hummel Home project is explicitly denied by the config guard.
- The original Hummel Home and JGC projects, websites, accounts, and calendars are unchanged.

## Setup and delivery verification

1. In **this new project's** Authentication → URL Configuration, set Site URL and an allowed redirect URL to `https://zethhummel-rgb.github.io/hh-family/`. Keep email confirmation enabled. This setting cannot be edited through the available Supabase connector.
2. Configure custom SMTP before inviting other households. Supabase's default mail service only delivers to organization team addresses, so it may be used to test the administrator's own confirmed account but is not sufficient for other families. Verify signup, confirmation links and password recovery with real inboxes.
3. Create a separate Google Cloud application named HH, enable Calendar API, and request only `https://www.googleapis.com/auth/calendar.app.created`. Its Web OAuth client must use this exact callback: the new project’s `/functions/v1/google-calendar/callback` URL, as shown in Supabase.
4. Store that new client's ID and secret in **HH Family's** Edge Function Secrets as `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`. Never reuse the original family's Google client or paste the secret into chat or source code. `APP_URL` can optionally override the default HH Pages address.
5. While the Google application is in Testing, add each household owner's Google email as a test user. Testing can require reconnecting after seven days. Finish Google's production/branding process before broad sharing. Each owner explicitly connects and creates their own app-owned secondary family calendar; other personal/work calendars remain separate.
6. Once the administrator's account is confirmed, create the first HH household. Under household settings, send up to fourteen email-bound **new-household** invitations. Invitations are emailed automatically; the copy-link fallback is also available. These do not add people to the administrator's family. Ordinary family invitations remain separate and household-scoped.
7. Verify actual Google consent/return, account recovery, cross-device family use, and phone push receipt before relying on those external integrations. Account email and Google connections have been configured. Verify invitation email delivery after adding the email-service secret, and verify recovery and push on actual devices.

## Automatic invitation emails

In **HH Family → Edge Functions → Secrets**, add `HH_EMAIL_APP_PASSWORD` using the dedicated sender account’s 16-character Google app password. Paste it only into the secret field, never chat, source, or frontend environment variables. The password saved for Supabase Auth SMTP is separate from Edge Function secrets. `HH_EMAIL_FROM` optionally selects a different dedicated Gmail sender; its app password must belong to that account. Existing Auth SMTP settings do not change.

The `invitation-email` function sends over Gmail SMTP with TLS on port 465. It validates the signed-in user, then resolves the owner/host permission, recipient and expiry from the existing invitation. It cannot send to an arbitrary address supplied by the browser. The private delivery ledger prevents concurrent/repeated sends and limits attempts per sender, recipient and service. Retries reuse the same invitation; no email is sent just by deploying or listing pending invitations.

The invitation is a normal household/pilot invitation, not an automatic account creation or passwordless login. The recipient signs up or signs in with the invited address, confirms it, then accepts the invitation. Successful delivery status means Gmail accepted the email; inbox or Spam placement must still be checked. If delivery cannot be confirmed, the UI preserves the copyable link and offers retry after a minute. Links are shown only when created; tokens are stored hashed, so a lost link requires a new invitation. The email audit tables record recipient, attempt times and status, not message bodies or SMTP credentials.

For an existing installation, apply only the additive invitation-email migration once. Never reapply the initial bootstrap. Then deploy `invitation-email` with its `index.ts`, `message.ts` and `smtp.ts`, leaving `verify_jwt=false` because the function explicitly validates the bearer session through `auth.getUser`.

## Rebuilding or provisioning

GitHub Actions tests and publishes on pushes to `main`. Optional repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` override the browser-safe defaults. Never place service-role, OAuth, or SMTP secrets in browser variables.

To provision a *different empty project*, enable Vault, pg_net and pg_cron, then apply `supabase/bootstrap.sql` once. Do not rerun it on this project or any existing family/work project. Privately seed the intended host's confirmed email in `private.pilot_hosts`. Set `home_together_api_url` in Vault to the target project's API URL (no trailing slash), and deploy all three Edge Functions (`google-calendar`, `event-reminders`, and `invitation-email`). Their bodies validate sessions/membership or single-use OAuth state/cron credentials, so their gateway setting remains `verify_jwt=false`.

## Families

Each household names its own home. Its owner can rename the home, add child/non-login profiles with colours, and later link those profiles to existing family accounts while preserving event tags. Accounts choose their own colours and personal palette. There are no preloaded relatives, events or lists. For the first pilot, times and reminders use Eastern time (America/Toronto); cross-timezone support is not implemented.

HH calendars work without Google, including daily/weekly/monthly/yearly repeats, custom intervals, count/date endings, occurrence edits/deletions and push reminders. Apply `database/native-calendar-repeats.sql` after the existing calendar/member-colour/push migrations. Native series store one household-scoped master with validated exceptions and optimistic version checks. The same Eastern-time expansion runs in calendar views, search and push delivery. Monthly dates absent in a month and February 29 in non-leap years are skipped. Native search shows one representative occurrence per series plus matching edited dates. Google remains optional; explicitly connecting copies native series and their changed/cancelled occurrences with retry-safe IDs.

Pilot invitations expire after 14 days, are single-use, require the exact confirmed email and reserve one of fourteen household places. Pending unused links can be revoked. Only a server-authorized host can issue them. A registered user without membership or an eligible invitation cannot create a home or see family data. Family member invitations expire after seven days and cannot create a separate home.

Profiles without a login route reminders to the household's opted-in accounts. Linked profiles route to the linked account. People and provider connections are always looked up inside the requesting household. Profile links cannot point at an account in another home. Notifications require device opt-in; iOS requires installing the PWA first.

## Verification

```
npm ci --ignore-scripts
npm run test:calendar
npm run test:database
npm run test:invitations
npm run build
```

The suite covers calendar timing and DST, Google auth retries, recurrence/search contracts, reminder deduplication, profile routing and account linking, invite-link precedence and confirmation redirects, and refusal to use the personal production database. The rolled-back database isolation test passed on the actual new project; security advisors returned only expected info notices for deliberately inaccessible private tables. Before inviting real families, test email confirmation, first household creation, new-home invitation acceptance/replay/wrong-email rejection, family invites, account recovery, Google connect, native/Google event changes and push receipt using actual pilot accounts. The isolated PostgreSQL suite additionally verifies host-only controls, invitation limits, revocation, wrong-email/unconfirmed/replay denial, household item/event/profile row policies, owner-only edits, cross-household profile linking rejection, and anonymous denial. It contacts no external database. Passing local checks does not verify those external services.

## Password reset codes

The HH reset screen verifies an emailed recovery OTP before updating a password (12–128 characters). Its separate, memory-only Supabase client never replaces the household login. No code or new password is stored in browser storage or URLs. Previously issued recovery links remain supported during rollout.

For the HH Family project only, set Authentication → Emails → Reset password to `supabase/templates/password-recovery.html`, with subject `Reset your HH password`. The email uses `{{ .Token }}` and a plain link to `https://zethhummel-rgb.github.io/hh-family/?reset=1`; do not use `ConfirmationURL` or `TokenHash` in that template. The static link performs no verification, so mail scanners cannot consume the code by opening it. Keep existing signup/invitation templates and SMTP settings unchanged.

Cutover order: publish the reset screen, then update the recovery template. Verify the email body and complete a user-controlled reset; automated tests use mocked auth and do not send emails or change anyone’s password. `npm run test:recovery` covers denial, retries, session isolation and template safety.

## New-home walkthrough

After successful household creation, the creator gets a five-slide, phone-oriented welcome tour. Joining an existing household does not trigger it. Pending state survives a refresh in the current tab; completion/Skip is stored per user and household on that device. Existing homes are not interrupted. Everyone can reopen it through Settings → Tutorials (at the bottom) → Take the quick tour. The tour itself performs no backend writes, permission requests, or invitations.
