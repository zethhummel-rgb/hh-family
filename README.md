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

## Remaining setup

1. In **this new project's** Authentication → URL Configuration, set Site URL and an allowed redirect URL to `https://zethhummel-rgb.github.io/hh-family/`. Keep email confirmation enabled. This setting cannot be edited through the available Supabase connector.
2. Configure custom SMTP before inviting other households. Supabase's default mail service only delivers to organization team addresses, so it may be used to test the administrator's own confirmed account but is not sufficient for other families. Verify signup, confirmation links and password recovery with real inboxes.
3. Create a separate Google Cloud application named HH, enable Calendar API, and request only `https://www.googleapis.com/auth/calendar.app.created`. Its Web OAuth client must use this exact callback: the new project’s `/functions/v1/google-calendar/callback` URL, as shown in Supabase.
4. Store that new client's ID and secret in **HH Family's** Edge Function Secrets as `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`. Never reuse the original family's Google client or paste the secret into chat or source code. `APP_URL` can optionally override the default HH Pages address.
5. While the Google application is in Testing, add each household owner's Google email as a test user. Testing can require reconnecting after seven days. Finish Google's production/branding process before broad sharing. Each owner explicitly connects and creates their own app-owned secondary family calendar; other personal/work calendars remain separate.
6. Once the administrator's account is confirmed, create the first HH household. Under household settings, generate up to three email-bound **new-household** invitation links. Share the links yourself. These do not add people to the administrator's family. Ordinary family invitations remain separate and household-scoped.
7. Verify actual Google consent/return, account recovery, cross-device family use, and phone push receipt before relying on those external integrations. SMTP and Google configuration are not yet completed or end-to-end verified.

## Rebuilding or provisioning

GitHub Actions tests and publishes on pushes to `main`. Optional repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` override the browser-safe defaults. Never place service-role, OAuth, or SMTP secrets in browser variables.

To provision a *different empty project*, enable Vault, pg_net and pg_cron, then apply `supabase/bootstrap.sql` once. Do not rerun it on this project or any existing family/work project. Privately seed the intended host's confirmed email in `private.pilot_hosts`. Set `home_together_api_url` in Vault to the target project's API URL (no trailing slash), and deploy both Edge Functions. Their bodies validate sessions/membership or single-use OAuth state/cron credentials, so their gateway setting remains `verify_jwt=false`.

## Families

Each household names its own home. Its owner can rename the home, add child/non-login profiles with colours, and later link those profiles to existing family accounts while preserving event tags. Accounts choose their own colours and personal palette. There are no preloaded relatives, events or lists. For the first pilot, times and reminders use Eastern time (America/Toronto); cross-timezone support is not implemented.

Pilot invitations expire after 14 days, are single-use, require the exact confirmed email and reserve one of three household places. Pending unused links can be revoked. Only a server-authorized host can issue them. A registered user without membership or an eligible invitation cannot create a home or see family data. Family member invitations expire after seven days and cannot create a separate home.

Profiles without a login route reminders to the household's opted-in accounts. Linked profiles route to the linked account. People and provider connections are always looked up inside the requesting household. Profile links cannot point at an account in another home. Notifications require device opt-in; iOS requires installing the PWA first.

## Verification

```
npm ci --ignore-scripts
npm run test:calendar
npm run test:database
npm run build
```

The suite covers calendar timing and DST, Google auth retries, recurrence/search contracts, reminder deduplication, profile routing and account linking, invite-link precedence and confirmation redirects, and refusal to use the personal production database. The rolled-back database isolation test passed on the actual new project; security advisors returned only expected info notices for deliberately inaccessible private tables. Before inviting real families, test email confirmation, first household creation, new-home invitation acceptance/replay/wrong-email rejection, family invites, account recovery, Google connect, native/Google event changes and push receipt using actual pilot accounts. The isolated PostgreSQL suite additionally verifies host-only controls, invitation limits, revocation, wrong-email/unconfirmed/replay denial, household item/event/profile row policies, owner-only edits, cross-household profile linking rejection, and anonymous denial. It contacts no external database. Passing local checks does not verify those external services.
