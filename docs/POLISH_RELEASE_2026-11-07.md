# Audited polish release to HH

User-authorized promotion from Hummel Home TEST on 7 November 2026. Source: TEST commit `76e1971076a971accd98eaab91c7bb33365f1105`.

Promotes the audited Home/header/form improvements, event duration handling, unfinished-change protection, sync feedback, grocery filtering and duplicate choices, persistent search categories, meal quantity totals, invitation-first signup and confirmation recovery, own-name editing, household-name prefix, wording and public-page explanations. Includes the three final layout corrections: horizontal event family rows, bounded sidebar names and the TEST banner positioning (the banner is excluded from the production build).

Production logos, manifest, existing households and integration handlers are retained. TEST seed/reset scripts and test-only integration handlers are excluded. No existing household is renamed by this release.

Database prerequisite: the tested own-name permission/assignment-preservation trigger from `database/member-colours.sql`, plus the updated `public.add_meal_ingredients` function in `database/meal-ingredient-quantities.sql`. Apply the release delta before publishing the client; both are compatible with the previous client. No destructive data migration is included.

Validation: the release PR runs the 36-configuration journeys and 51 focused checks in Chromium, Firefox and WebKit with synthetic loopback APIs. A separate job runs the regression suite and builds production, checking the live backend, original branding and offline shell. Email delivery, push delivery and physical iPhone behavior are not claimed by these synthetic tests.
