# Calendar and event-entry release — 8 November 2026

User-authorized promotion from Hummel Home TEST commit `d233b1260cd289ac15c2d14e1288aca9dc2e3419`.

## Changes

- Compact agenda with smaller day headings, time columns and family indicators.
- Single-row Agenda / 3 Day / Month selector, with three-day navigation across month and year boundaries.
- Today / Filter / + Event action row and an on-demand family filter.
- Compact grouped event editor with a fixed Cancel / title / Save header, wrapping family chips and directly visible repeat, alert, countdown and notes controls.
- Start and End time choices at 15-minute intervals. Existing off-quarter times are retained without silent rounding; moving a start still preserves duration.
- Calendar view preference persists across navigation, refresh and reopening on the same device, scoped to the signed-in account and household.

## Promotion boundary

Application files and their regression checks are copied from the tested source. Production publishing, branding, backend configuration and existing integration handlers remain the production versions. No database migration, household record change or test-data copy is part of this release.

## Validation

The release workflow runs calendar-specific checks and 36 household configurations in Chromium, Firefox and WebKit, plus the existing focused suites. It also runs the regression suite, production build and production configuration checks. After deployment, the publication workflow compares the hosted files to the build artifact.

The calendar reload test records WebKit inspector diagnostics for cancelled synthetic loopback requests separately from app exceptions, only during deliberate reloads and only when the stack identifies WebKit's inspector bootstrap. It still checks successful calendar loading and all actual app errors. Service workers remain enabled.
