# Modern UI Architecture

## Purpose

`/modern/` is the default user-visible workspace. The root route enters it after login checks, and normal browsing, configuration, resource management, and chat workflows stay inside the Modern UI.

This layer modernizes the frontend without replacing SillyTavern's backend contracts or user-data formats. Legacy frontend resources and the hidden bridge may remain internal dependencies, but they are not normal navigation destinations.

## Invariants

1. `/` and `/modern/` enter the Modern UI while preserving relevant query parameters.
2. The Modern UI does not expose a routine “open legacy/original UI” action.
3. Existing `/api/...` payloads, responses, defaults, errors, and storage semantics remain compatible unless a change explicitly updates the contract.
4. The hidden legacy bridge is an implementation detail, primarily for existing generation behavior.
5. New user-visible capabilities are implemented in the appropriate Modern route instead of adding a second workflow.
6. External provider and public-network behavior is tested only through explicitly enabled external-dependency coverage.

## Current route surface

`public/modern/core/constants.js` defines 13 routes:

| Route ID | Responsibility |
| --- | --- |
| `dashboard` | Resource overview, recent conversations, and status entry points |
| `chat` | Character/group conversations, messages, generation, chat files, and backups |
| `characters` | Character create, edit, import, copy, rename, avatar, and delete |
| `groups` | Group create, edit, membership, and group chat entry |
| `worldbooks` | World book files, activation, entry editing, and bulk operations |
| `presets` | Preset selection, import, copy, export, restore, and delete |
| `personas` | Persona create, avatar, default selection, and delete |
| `assets` | Backgrounds, folders, uploads, downloads, rename, and delete |
| `remoteResources` | Provider search, download/import/install, credentials, and history |
| `api` | Main API configuration, secrets, models, connection tests, and request settings |
| `extensions` | Extension list, install, update, move, extension-repository branch selection, and delete |
| `activity` | Recent resource activity and object navigation |
| `settings` | Modern UI preferences and settings snapshots |

The constants file is the route-list source of truth. Do not duplicate the route count in tests or code when it can be derived.

## Frontend ownership

- `public/modern/app.js`: application composition and startup only;
- `public/modern/core/`: shared state, API client, constants, utilities, and hidden bridge;
- `public/modern/shell/`: navigation, routing, loading, command palette, inspector, topbar, and render coordination;
- `public/modern/routes/`: route rendering and route-level event binding;
- `public/modern/actions/`: business actions and backend calls grouped by domain;
- `public/modern/components/`: route components and reusable UI fragments;
- `public/modern/styles/`: base, shell, layout, component, overlay, responsive, and route styles.

Keep behavior near its owning domain. Add a shared abstraction only when multiple current consumers have the same semantics.

## Backend boundaries

- Modern code calls the existing backend; it does not create a parallel modern-only backend.
- Request and response normalization belongs in the API client or owning action, not in render-only components.
- User-visible errors must retain enough backend context to diagnose the failed action.
- Secrets remain in existing secret storage and are exposed to the browser only as state needed by the UI.
- Data migrations belong in backend startup or data-management code, not frontend fallbacks.

## Remote resources

`src/remote-resources/provider-registry.js` owns the registered provider list. Individual files under `src/remote-resources/providers/` own provider-specific search, validation, and download behavior.

Provider rules:

- use fixed, reviewed origins instead of an arbitrary proxy;
- validate resource IDs, URLs, MIME types, and file structure before import;
- keep credentials in secret storage;
- record imported source relationships separately from imported content;
- report partial provider failures without hiding successful results from other providers.

Because third-party sites change independently, documentation describes implemented behavior rather than claiming permanent availability.

## Test ownership

- `tests/modern-workspace.e2e.js`: entry, routes, shell, and absence of visible legacy navigation;
- `tests/modern-*.e2e.js`: route-focused mocked behavior;
- `tests/modern-action-helpers.e2e.js`: action helper behavior;
- `tests/modern-real-backend-integration.e2e.js`: UI-to-real-backend contract paths;
- `tests/modern-external-dependencies.e2e.js`: public URLs, external Git repositories, downloads, and real provider smoke tests.

Coverage is a maintained test property, not a permanent documentation claim. When an endpoint or workflow changes:

1. identify the user action that reaches it;
2. update the nearest route test;
3. add or update real-backend coverage when the backend contract matters;
4. use external-dependency coverage when success depends on public state;
5. verify a user-visible result rather than only observing a request.

## Change rules

- Do not expose the hidden bridge as user navigation.
- Do not add a legacy fallback to avoid completing a Modern workflow.
- Preserve API and state contracts during mechanical moves.
- Keep loading, empty, success, and error states with their owning workflow.
- Validate character and group chat behavior together when shared chat code changes.
- Validate desktop and mobile interaction when layout or overlays change.
- Update `README.md` and this document when route ownership, entry behavior, provider registration, or test responsibilities change.

## Validation

Use the current commands in `README.md`. At minimum:

- every change: `git diff --check`;
- JavaScript: syntax checks and `npm run lint`;
- route behavior: the nearest Modern E2E file;
- shared routing, state, API, chat, or backend changes: real-backend or complete Modern E2E;
- public network or supplier behavior: explicitly enabled external-dependency tests.

This document records the maintained architecture. Product ideas and unfinished work belong in issues, not in a permanent “refactor plan.”
