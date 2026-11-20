# Outlook Calendar trial

The trial runs on Hummel Home TEST. A household member connects a personal Microsoft account and chooses one existing writable Outlook calendar. Initial sync includes upcoming one-time events from both calendars. Edits and deletions then sync both ways for paired events. Private events, meetings, attachments and repeating events are excluded. If both copies change before the next sync, both are preserved for review.

## Set up TEST

1. In Microsoft Entra, register a Web app for personal Microsoft accounts. Add `https://ybizqfghnplcxlmlhvyn.supabase.co/functions/v1/outlook-calendar/callback` as its redirect URI. Use delegated Microsoft Graph `User.Read` and `Calendars.ReadWrite`.
2. Apply the Outlook migration and deploy the `outlook-calendar` function to the TEST project. Configure `TEST_OUTLOOK_CLIENT_ID`, `TEST_OUTLOOK_CLIENT_SECRET`, and `TEST_OUTLOOK_TEST_EMAIL` as TEST Edge secrets. The tester signs in to HH with the same email used on their Microsoft account.
3. Enable background sync by adding a Vault entry named `hh_test_outlook_origin` with the TEST project URL `https://ybizqfghnplcxlmlhvyn.supabase.co`. The worker uses the TEST project's existing `hummel_push_cron` credential.
4. Sign in to Hummel Home TEST, open **Settings → Calendar → Connect Outlook**, and approve calendar access in Microsoft. Choose the family calendar after returning to HH. Use **Sync now** to check the connection.

Verify a disposable timed event and an all-day event in both directions before expanding the trial. Check that Microsoft consent returns to the picker, that only the selected calendar changes, and that disconnect stops syncing while leaving events in both calendars.
