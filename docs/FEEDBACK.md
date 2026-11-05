# Send Feedback

Members open More → Send Feedback or Settings → Send Feedback, choose an HH area or New Feature Suggestion and enter up to 5,000 characters. The server emails the fixed recipient hummelhomeapp@gmail.com with the comment, selected area, member display name, household name and verified account email as Reply-To.

## Release and configuration

This feature was reviewed in Hummel Home at commit 6f963994f875101f2a09e5baae14cffaa1359d05 and approved by Zeth for production on 2026-11-05. The live project is njpdqiwrwgoothkstoql. Apply only the additive hh_send_feedback migration and deploy send-feedback with its relative shared dependencies before publishing the frontend. No test fixtures, resets, staging configuration or test branding are part of this release.

The handler reuses the project's existing HH_EMAIL_APP_PASSWORD and optional HH_EMAIL_FROM Edge Function secrets. The default sender and only recipient are hummelhomeapp@gmail.com. No app password is exposed in the client or repository. The GET endpoint with the app Origin reports configured true/false, which verifies configuration presence but does not prove Gmail acceptance or inbox delivery.

Hummel Home remains a preview environment without an email credential. No credential setup is needed there. Live HH email subjects begin [HH]; the test branch uses [HH TEST] if ever deliberately configured.

## Privacy and delivery

The handler verifies the bearer token with auth.getUser, requires a confirmed account and checks current household membership. The service-only RPC stores submissions privately; anonymous and authenticated clients cannot read this table or invoke that RPC. Feedback is not placed in the shared family activity feed.

Claims are serialized and limited to one message per 30 seconds, five per user per hour and 100 total per hour. An unchanged request ID never sends twice. Client-supplied recipients and sender identities are ignored. SMTP acceptance produces success; errors retain the comment. Uncertain submissions are not automatically retried, to avoid duplicates. Inspect the private delivery status and mailbox reference before any manual resend.

Database records cascade when the account or household is deleted. Mailbox copies have independent support retention, disclosed in the privacy page. No existing household records are altered by the migration.

## Validation

Run test:feedback and the existing calendar, database, invitations, recovery and welcome suites, then the production build. Feedback checks cover fixed recipient, HTML/header safety, confirmed accounts, membership, RPC privileges, rate limiting, deduplication, session refresh/account changes and honest success/failure responses. The form was reviewed at 390px width with mocked success, failure and unavailable-email states. Real delivery is verified separately and must not be claimed from mocked tests.

Production verification on 2026-11-05: all listed suites, the production build and Pages deployment passed. The first live send reached the 15-second SMTP timeout and remained uncertain; it was not automatically retried. Feedback now allows 30 seconds and logs only submission IDs and fixed transport stage names, never message content, credentials or server replies. Invitation delivery retains its existing default timeout. A separate live test was accepted by Gmail and recorded as sent at 18:34:14 UTC; the signed-in HH form displayed its success confirmation. Inbox receipt was not independently inspected.
