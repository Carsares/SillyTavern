# Security policy

The maintained application consists of the Conversation v1 server, browser, shared modules and their dependencies on `master`.

Use the repository's private vulnerability reporting facility when available, or contact its maintainer privately. Include the affected commit, operating system, Node.js version, deployment mode, impact, and a minimal reproduction with synthetic data. Never publish credentials, private chats, cookies or unredacted logs.

In scope are authentication, request validation, credential handling, conversation persistence, attachment handling, provider transports and SDK process isolation. External model services and independently managed proxies are outside this repository's control.

Remote listening requires a password and explicit allowed hosts. Deploy behind a trusted HTTPS reverse proxy. SDK isolation is currently supported on macOS only; unsupported platforms must fail explicitly. Native PI execution has no dependency on that SDK isolation backend.

Do not perform destructive tests or paid external calls without explicit authorization. Coordinate disclosure with the maintainer after a fix is available.
