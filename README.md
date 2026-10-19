# HH — private family pilot

A separate application derived from Hummel Home's code. The original GitHub repository, website, Supabase project, accounts, calendar connection and notification service are not modified. This copy contains no family accounts, events, lists, OAuth secrets, refresh tokens, or notification subscriptions.

## Status

Source is prepared and frontend/mocked integration checks run locally. A new Supabase project could not be created because the personal account has reached its two-active-free-project limit. The new GitHub repository is https://github.com/zethhummel-rgb/hh-family. This pilot is **not live** and real signup, email delivery, database policies, Google consent, and phone notifications have not yet been verified on a new backend.

The unconfigured app displays a setup screen and never accepts sign-ups. A configuration guard refuses to connect to the original Hummel Home project. Search indexing is disabled in initial HTML. Existing Hh monogram assets are reused with HH as the installed app name.

## Separate deployment

1. Use the new repository https://github.com/zethhummel-rgb/hh-family. Do not use the existing `hummel-home` repository.
2. Create a **new** Supabase project in the personal Hummel Home organization, in Canada Central. Free a project slot or explicitly approve any plan upgrade first. Do not pause, delete or repurpose Hummel Home or JGC.
3. Enable Supabase Vault, pg_net and pg_cron for the new project. Run `node scripts/assemble-database.mjs`. Apply `supabase/bootstrap.sql` once to that fresh empty project. Never apply it to an existing family database. Record the real migration version returned by Supabase when it is applied.
4. Privately authorize the pilot host by inserting their confirmed sign-up email into `private.pilot_hosts`. This table is server-only. Do not use editable user metadata to grant host access. Do not copy an existing auth user into the new database.
5. Set the new repository's Actions variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the new project's URL and publishable key. These are browser-safe; never use a secret or service-role key here.
6. Enable GitHub Pages using GitHub Actions. The included workflow tests, builds and publishes `dist/`. The final URL will be that new repository's Pages URL. Set Supabase Auth Site URL and allowed redirect URLs to that exact address. Keep email confirmations on and configure SMTP for invited recipients; test confirmation and password reset with real inboxes.
7. Deploy the two Edge Functions from `supabase/functions`, keeping gateway `verify_jwt=false` because their bodies perform their own authentication and the Google callback/cron have separate authentication. Set `APP_URL` in **the new project's** secrets to the exact new Pages URL including the repository path and trailing slash. It controls CORS, OAuth return and push click targets.
8. In the new project's Vault create `home_together_api_url` with its Supabase API URL (no trailing slash). The notification setup creates a separate scheduler secret and VAPID keys for this project; never copy Hummel Home's secrets.
9. Create a separate Google Cloud application named HH, enable Calendar API, and request only `https://www.googleapis.com/auth/calendar.app.created`. Register the new callback `https://NEW_PROJECT.supabase.co/functions/v1/google-calendar/callback`. Store that client's ID and secret as `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` in the new Supabase project. Never reuse the personal family's Google OAuth client.
10. While Google is in Testing, add each invited household owner's Google email to its test users. Testing can require reconnecting after seven days. Finish Google's production/branding process before broad sharing; the exact review depends on scopes. Each household owner explicitly connects, creating their own app-owned family calendar. Existing personal/work calendars are not imported.
11. Sign up afresh as the authorized pilot host, confirm the email and create a home. Under household settings, generate up to three email-bound **new-household** invitation links. Share them yourself. These do not invite people into the host's own family. Ordinary family invitations remain separate and household-scoped.

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

The suite covers calendar timing and DST, Google auth retries, recurrence/search contracts, reminder deduplication, profile routing and account linking, invite-link precedence and confirmation redirects, and refusal to use the personal production database. Before inviting real families, run the rolled-back database isolation test against the new project, check advisors, and test email confirmation, first household creation, new-home invitation acceptance/replay/wrong-email rejection, family invites, account recovery, Google connect, native/Google event changes and push receipt using actual pilot accounts. The isolated PostgreSQL suite additionally verifies host-only controls, invitation limits, revocation, wrong-email/unconfirmed/replay denial, household item/event/profile row policies, owner-only edits, cross-household profile linking rejection, and anonymous denial. It contacts no external database. Passing local checks does not verify those external services.
