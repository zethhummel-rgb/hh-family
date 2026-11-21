# Calendar sync deployment

The HH release uses the production Supabase project and the existing production Google OAuth client. Hummel Home TEST keeps its own credentials and connection state.

1. Apply the personal Google calendar and two-way sync migrations in timestamp order. Confirm the existing `home_together_api_url` and `hummel_push_cron` Vault entries are configured for live HH. The new workers run only for connected accounts on that project.
2. Deploy `google-calendar` and `outlook-calendar` to live HH with their checked-in settings. Keep the existing Google OAuth credentials and callback. Leave `HH_GOOGLE_TWO_WAY_ENABLED` unset while Google verification is pending.
3. Use a separate Microsoft Entra Web client for personal Microsoft accounts with the live Outlook callback `https://njpdqiwrwgoothkstoql.supabase.co/functions/v1/outlook-calendar/callback`. Store its app ID and credential in `HH_OUTLOOK_CLIENT_ID` and `HH_OUTLOOK_CLIENT_SECRET`. Replace the credential before it expires.
4. Verify the production Google branding and calendar-event scope in Google Auth Platform. Once approved, set `HH_GOOGLE_TWO_WAY_ENABLED` to `true`. The same production client continues to support older Google connections and the one-time import.
5. Publish the validated Pages build. With an authorized trial account and a disposable calendar, confirm the return dialog, dedicated and existing calendar setup, and timed, all-day and supported repeating event changes in both directions. Verify that deleting a linked appointment removes it from each participating calendar. Finally, verify that disconnect stops updates and leaves existing events in place.

The Microsoft registration uses standard Microsoft Graph Calendar endpoints. The Edge Functions and scheduled workers run in Supabase.
