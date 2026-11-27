# Live HH releases

V2.4 brings the reviewed TEST dashboard, notices, scheduled palettes, ratings, release queue, centred iPhone icon, and announcement-history footer to live HH. The household app still uses the live Supabase project and its existing sign-ins and invitation links.

## First rollout

1. Complete validation on the live release pull request. Merging the approved branch makes the new workflow available without publishing either app address.
2. At the approved rollout window, apply the checked admin/content migrations from `20261126210000` through `20261127104911` to live Supabase in order. In the same rollout, deploy the updated `admin-households`, `request-pilot-invitation`, `send-feedback`, `invitation-email`, and `hh-release-dispatch` functions to that project. Keep the release dispatch switch off until access and credentials are verified.
3. Verify that `zethhummel@gmail.com` is the only row in `private.hh_site_admins` and that `private.hh_admin_auth_policy.require_mfa` is true. The migration uses the existing confirmed pilot host as the invitation issuer. Check that the personal HH sign-in opens the admin dashboard after authenticator verification and that both app-mail accounts are denied access to Admin and Manage households.
4. Publish the checked V2.4 production build to the existing Cloudflare Pages project `hh-family-app` and the original GitHub Pages site. This first publication installs the Admin release screen. Confirm the same approved version, both app addresses, guest and invite links, noindex, ordinary household sign-in, and the admin authenticator gate. Do not copy TEST accounts, announcements, preferences, or credentials.

## Using the live release button

- GitHub's **Publish a prepared HH release** workflow prepares and registers a build from the live repository's `main` branch. Use a new app version when preparing a new change. The checked archive is retained for 30 days.
- In Admin on `app.hhfamily.ca`, select a checked build, save the release announcement, and confirm **Release to Live HH**. The workflow publishes the same archive to both app addresses and verifies the served release marker and asset checksums before posting the announcement.
- If either host fails verification, the announcement stays saved. Refresh the release record before retrying. The original GitHub Pages workflow is manual for setup and recovery.

## Credentials

Restrict GitHub environments `hh-live-release-prepare` and `hh-live-release-deploy` to `main`. Store a new matching `HH_RELEASE_WORKER_KEY` in both environments and live Supabase Edge Function secrets. Store `HH_LIVE_CLOUDFLARE_API_TOKEN` and the `HH_LIVE_CLOUDFLARE_ACCOUNT_ID` variable in the deploy environment. Cloudflare Pages write is account-scoped. The workflow checks that the target project serves only the live app domain and the project's own Pages domain.

In live Supabase, set `HH_RELEASE_GITHUB_TOKEN` to a credential limited to Actions write on `zethhummel-rgb/hh-family`. Set `HH_RELEASE_OPERATOR_ID` to the approved personal admin's confirmed live user ID. Enable `HH_RELEASE_DISPATCH_ENABLED` only after validating those settings and the deployment environments.
