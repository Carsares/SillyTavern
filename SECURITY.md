# Security Policy

## Supported code

This fork supports the current `master` branch. Upstream `staging` and `release` branches are not maintained in this repository.

Security reports should identify the commit tested, deployment mode, operating system, Node.js version, and whether the issue also reproduces in upstream SillyTavern.

## Report a vulnerability

Use the repository's GitHub **Security** tab and choose **Report a vulnerability** when private vulnerability reporting is available.

Include:

- affected commit and files;
- impact and realistic attack conditions;
- minimal reproduction steps or proof of concept;
- relevant configuration with all secrets removed;
- suggested mitigation, if known.

Do not publish an exploitable vulnerability, API key, cookie, token, private chat, user data, or unredacted log in a public issue, discussion, or pull request.

If GitHub private reporting is unavailable, contact the repository maintainer privately before sharing exploit details. General upstream vulnerabilities should also follow the upstream SillyTavern disclosure process.

## Scope

In scope:

- code maintained by this repository;
- the `/modern/` frontend and its hidden legacy bridge;
- backend routes and data handling changed by this fork;
- authentication, authorization, secret storage, import/download validation, and path handling;
- bundled dependencies when the repository can directly mitigate the risk.

Out of scope:

- third-party model providers, resource sites, extensions, reverse proxies, or deployment platforms not maintained here;
- availability failures or content changes on external sites;
- vulnerabilities that require publishing real user secrets or destructive tests.

For dependency or upstream issues, report to the responsible project as well. A fork-specific mitigation can still be proposed when this repository is affected.

## Handling expectations

Maintainers will validate the report, assess affected code, and coordinate a fix where possible. Response and remediation time depend on severity, reproducibility, upstream dependencies, and maintainer availability.

Keep details private until maintainers confirm that disclosure is safe.
