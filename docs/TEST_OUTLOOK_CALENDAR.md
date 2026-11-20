# Outlook Calendar trial

The trial runs on Hummel Home TEST. Choose a writable Outlook calendar or use **Create HH Family calendar** to prepare a dedicated one. **Send HH events to Outlook** copies upcoming HH events to that calendar and syncs changes to paired events. **Use both HH and Outlook** also brings eligible Outlook events into the HH household. Private events, meetings and attachments are excluded. If both copies change before the next Outlook sync, both are preserved for review.

Outlook and Google can sync daily, single-weekday weekly, same-date monthly and yearly series, with optional end dates or occurrence counts. A moved or cancelled occurrence belongs to its original date in the series. Timed repeats use HH's Eastern time zone. The Outlook trial skips monthly repeats on the 29th through 31st and yearly repeats on February 29. Outlook may require review to restore an occurrence already cancelled there. Keep custom patterns, such as the second Tuesday of each month, on the calendar that created them.

## Set up TEST

1. In Microsoft Entra, register a Web app for personal Microsoft accounts. Add `https://ybizqfghnplcxlmlhvyn.supabase.co/functions/v1/outlook-calendar/callback` as its redirect URI. Use delegated Microsoft Graph `User.Read` and `Calendars.ReadWrite`.
2. Apply the Outlook migration and deploy the `outlook-calendar` function to the TEST project. Configure `TEST_OUTLOOK_CLIENT_ID`, `TEST_OUTLOOK_CLIENT_SECRET`, and `TEST_OUTLOOK_TEST_EMAIL` as TEST Edge secrets. The tester signs in to HH with the same email used on their Microsoft account.
3. Enable background sync by adding a Vault entry named `hh_test_outlook_origin` with the TEST project URL `https://ybizqfghnplcxlmlhvyn.supabase.co`. The worker uses the TEST project's existing `hummel_push_cron` credential.
4. In Hummel Home TEST, open **Settings → Calendar**. Under **Outlook Calendar**, choose **Send HH events to Outlook** or **Use both HH and Outlook**, then sign in to Microsoft. When you return, choose an Outlook calendar or create **HH Family**. Select the start button to finish and **Sync now** to check the connection.

Verify a disposable timed event and an all-day event in both directions before expanding the trial. Check that Microsoft consent returns to the picker, that only the selected calendar changes, and that disconnect stops syncing while leaving events in both calendars.

## Google Calendar choices

**Send HH events to Google** creates a dedicated Google calendar for HH. **Use both HH and Google** asks for Google Calendar list and event-editing permissions, then lets you choose an existing writable calendar and confirm sharing with the household. Imports keep the original Google event IDs for ongoing edits and deletions. This trial's incoming sync excludes private events, meetings, attachments and repeats. Disconnecting leaves the events already present on each side.
