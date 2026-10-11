# Repository instructions

- When building a new feature, first look for high-quality GitHub projects and npm packages that can be reused. Check their maintenance, license, and fit before adding a dependency.
- Delete sentences whose only purpose is to prevent criticism rather than advance the argument.
- Read the relevant source and documentation before editing. Keep changes within the assigned scope and preserve other contributors' work.
- Keep the server authoritative for movement, private information, inventory, match results, and settlement. Client visuals must follow the authorized view.
- Use Node.js 24 and the committed npm lockfile. Default to static validation (type checking, production builds, source and asset checks). Do not launch browser tests, live multiplayer integration tests, or device/GPU sampling unless the user explicitly requests them. Report what was actually validated.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md). Every commit subject, body, and footer must be in English. Use `type(scope): concise action`, make one logical change per commit, and include `Why:` and `Validation:` in the body.
- Never commit credentials, private environment files, player databases, or backups.
