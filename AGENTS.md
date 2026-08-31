# Relay integration instructions

These instructions apply when the user asks to add, connect, integrate, or demo
Relay in a consumer application. For unrelated work, follow the application's
existing conventions. If this repository is the Relay source repository itself,
do not add a consumer-facing login UI unless the user explicitly requests one.

## Objective

Analyze the application and implement the smallest complete Relay integration
that fits its current architecture and visual language. Do not merely describe
the integration or leave pseudocode when the repository can be edited.

Relay must be visibly identified in the user experience. A signed-out visitor
must be able to find and open Relay authentication from a clickable control near
the top-right of the site. The authentication screen or dialog must also contain
the word `Relay`.

## Analyze before editing

1. Read the repository instructions and inspect the package manager, framework,
   routing, layouts, styling system, authentication, state management, tests,
   environment-variable conventions, and existing API/client abstractions.
2. Find the shared site header or highest reusable navigation component. Prefer
   one integration point over duplicating a Relay button on individual pages.
3. Determine whether the application already has user accounts. Preserve the
   existing account system unless the user explicitly asks Relay to replace it.
   If both systems exist, keep their identities distinct and expose an explicit
   link/connect step rather than silently treating matching email addresses as
   the same person.
4. Determine which Relay mode is actually available:
   - Use `MultiplayerClient` from `@relay/sdk` when a Relay API URL is configured.
   - Use `createMockRelay` from `@relay/mock` only for an explicitly local demo
     or placeholder. Keep one shared mock backend instance for every simulated
     client that must see the same data.
   - If neither package or source is available, do not invent an API. Report the
     missing dependency and implement only clearly separable UI scaffolding.

## Required UI behavior

- When signed out, place a visible button or link in the shared header's
  top-right action area. Prefer the label `Sign in with Relay`. `Relay login` is
  acceptable when space is limited.
- Clicking it must open a working Relay sign-in route, dialog, drawer, or panel.
  Do not use a dead button.
- The opened surface must visibly say `Relay`, preferably with a heading such as
  `Sign in to Relay`.
- Provide email and password fields, submit behavior, loading state, useful
  validation/error feedback, and keyboard-accessible focus handling.
- If registration is supported, provide a clear path between Relay sign-in and
  Relay account creation. Do not combine both flows into an ambiguous form.
- When signed in, replace the sign-in control with the Relay username/avatar or
  a compact account menu. Keep `Relay` visible in the menu or its accessible
  label, and include a working sign-out action.
- Preserve the host application's typography, spacing, colors, responsive
  breakpoints, and component patterns. On narrow screens, put the Relay action
  in the existing mobile navigation while keeping it easy to discover.
- Do not claim social login, password reset, account linking, or other features
  unless they are actually implemented.

## Client integration

- Type application-facing code against `MultiplayerClientContract` so mock and
  hosted implementations can be swapped without rewriting UI components.
- Construct the client in one module and inject or provide it through the
  application's existing state/context pattern. Do not instantiate a new client
  on every render.
- Restore authentication during application startup when token storage is
  available, expose an initializing state, and avoid briefly rendering the
  signed-out UI before restoration finishes.
- Keep hosted Relay's base URL in the application's normal public environment
  configuration. Fail with a useful development message when it is missing.
- Never place database credentials, JWT signing secrets, service credentials, or
  refresh tokens in source control. Do not expose server-only secrets to browser
  bundles.
- Treat mock mode as disposable development data. Make its use obvious in code
  and prevent it from being selected silently in a production build.

## Feature integration

- After authentication works, identify the application's natural collaborative
  surface (for example a draft, lobby, workspace, game, or shared project) and
  connect Relay there using the capabilities that actually exist.
- When the app has a collaborative surface, provide a discoverable way to view
  members and invite another Relay username. Show pending, success, and error
  states rather than assuming an invitation was accepted.
- Add direct/group messaging or realtime message indicators only where they fit
  the product. Reuse existing panels, menus, and notification patterns.
- Relay currently supplies identity, application membership, invitations,
  conversations, messages, and message events. Do not describe it as game-state
  synchronization or silently send domain data through chat messages. Keep game
  or document state in the host application's own backend unless a real Relay
  state-sync API is present.
- Do not broaden a request that is explicitly limited to authentication. In
  that case, leave a clean client/provider boundary for later collaboration
  features and document the next connection point.

## Verification

Before declaring the integration complete:

1. Run the repository's formatter, typecheck, tests, and production build when
   available.
2. Verify the Relay control appears at the top right on desktop and remains
   reachable on mobile.
3. Verify click-through, invalid credentials, successful sign-in, restored
   session behavior where supported, signed-in display, and sign-out.
4. If using mock mode, verify two clients created by the same mock backend can
   register, invite, accept, and exchange a message.
5. Summarize what changed, which Relay mode is active, required environment
   variables, tests run, and any real-backend work that remains.

## Completion boundary

A visual Relay button alone is not a completed integration. Completion requires
a working authentication interaction wired to the available Relay client,
honest handling of mock versus hosted mode, responsive and accessible UI, and
verification appropriate to the application.
