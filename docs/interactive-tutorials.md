# Interactive practice tutorials

Sixteen optional lessons use the real portal pages and forms. Launch them from
More → Help & tutorials, the page footer's Show me how link, or the welcome tour.
Written references and instructions for Safari/Android installation and external
Google setup remain available under Written guides & phone setup.

## Behaviour

- The user starts practice explicitly; lessons never auto-open on page visits.
- Buttons, fields and settings receive a spotlight. Required actions must be
  performed before continuing. Informational steps have an explicit Continue.
- Lessons cover Home, calendar views and events, event options, groceries,
  Staples, to-dos, meal planning, saved meals, notes, weekly overview, search,
  own-name changes, calendar colour, family profiles, invitations and feedback.
- Owners' household-management lessons are disabled for other family members.
- Finishing, restarting or exiting removes practice forms. Stopping a lesson
  offers Keep practising or Exit practice; the practice values stay only in RAM.
- Starting a lesson protects any existing real draft through the ordinary
  Save / Discard / Keep editing guard.
- The previously preferred calendar view is restored after practice.
- Only completed lesson IDs are stored, scoped to app path, user and household.
  No typed practice values are stored. Storage failure does not block lessons.
- Coach marks follow scrolling and the visual viewport. Keyboard Tab visits the
  active control and coach controls; Escape offers an explicit exit. Each active
  control references its instruction with aria-describedby. While both the editor
  and coach are interactive, editor aria-modal is temporarily false and restored
  on exit. Reduced motion disables the limited spotlight pulse.

## Practice safety contract

`InteractiveTutorialProvider` owns the session and keeps the controller identity
stable while coaching text/steps change. This avoids re-rendering controlled
inputs during their native input events.

`useTutorialPractice().intercept(kind)` must run before a lesson's save handler
performs an API call, queues an offline change or invokes a mail function. It
returns true throughout practice. It completes the lesson only at its matching
Save step; other attempted saves are blocked. Normal saves return false.
Do not implement a lesson by issuing a real save and deleting it afterwards.

Document capture also restricts clicks to the current target/coach, prevents
unrelated submits, and permits the invitation's non-mutating review step. This
is a usability guard; the per-handler intercepts are the write boundary. The
existing backend authorization and validation remain unchanged.

New lessons must use stable target markers or existing accessible field labels,
have a matching intercept before every relevant mutation path, and be included
in the browser journey test. Never automatically send email, delete records or
trigger external account/notification permissions to advance a lesson.

## Verification

`scripts/polish-browser/interactive-tutorials.cjs` runs every lesson with synthetic
API fixtures. It checks required actions, preserved typing, viewport fit at
320/390/1280px including short screens, preferred-view restoration, zero practice
mutation/mail requests, unchanged fixture records, no persisted practice input,
exit/restart/scroll-lock behaviour, reduced motion, protection of an existing
ordinary draft and a successful normal save after exiting practice.

The TEST browser workflow runs it in Chromium, Firefox and WebKit alongside the
existing full portal journeys. Physical iPhone keyboard and native picker
behaviour still requires device confirmation.
