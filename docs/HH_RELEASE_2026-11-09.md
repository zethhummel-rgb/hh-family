# HH tutorial and usability promotion

Promotes TEST PRs #27, #28 and #29 onto HH main at dcf9ffe.

- Sixteen interactive practice lessons with action-only highlighting and keyboard-safe coach controls.
- Draft protection, Save/Discard/Keep editing, failed-save retention, larger-text layout, invitation review/correction/resend/cancellation, quieter save notices and password visibility controls.
- All source differences between current HH and TEST were inspected. The source changes belong to these three features; HH configuration and Supabase client files have no differences.
- Production Pages workflow, offline shell, publication verification, production variables, backend functions and existing database migrations are retained. TEST branding, seed/reset scripts, backend delivery restrictions and SMTP/logging differences are excluded.
- Invitation correction/resend requires the additive reissue-invitation function migration. It adds owner-checked, idempotent, atomic replacement functions without changing existing rows or policies. Browser tests use isolated fixtures and local database tests use PGlite.
- Physical iPhone keyboard and system text-size behaviour still require a device check; automated keyboard coverage simulates VisualViewport changes.

Release gate: all three browser engines, existing production regression/build checks, and invitation authorization tests must pass before merge. Apply and verify the additive function before deploying its caller. Verify Pages publication against the built artifact after merge.
