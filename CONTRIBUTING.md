# Contributing to Soulwisp: Returnlight

Use Node.js 24 and install the committed dependency tree with `npm ci`. Read the [local development guide](docs/local-development.md) for services and test prerequisites.

## Commit messages

Every subject, body, and footer must be written in English. Use this repository's [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format:

```text
type(scope): concise action

Why: Explain the problem and why this change solves it.
Validation: Name the checks run and their actual results.
```

The scope and both body sections are required by this repository. Keep the subject at most 72 characters, start its description with a lowercase action verb, and omit the final period. Use lowercase scopes that name the affected area, such as `game`, `render`, `ui`, `rules`, `accounts`, `voice`, `server`, `assets`, `deploy`, `docs`, or `tooling`.

| Type | Use |
| --- | --- |
| `feat` | Add a capability |
| `fix` | Correct behavior |
| `perf` | Improve performance |
| `refactor` | Restructure code while preserving behavior |
| `docs` | Update documentation |
| `test` | Add or improve verification |
| `style` | Change formatting |
| `build` | Change dependencies or build tooling |
| `ci` | Change continuous integration |
| `chore` | Maintain repository tooling or assets |
| `revert` | Revert a prior change |

Make one logical change per commit. Include implementation, its necessary tests, and directly related documentation together. Include a lockfile change with the dependency change it records. Separate unrelated fixes. Explain the reason in `Why:`; describe observable behavior and checks in `Validation:`. If a relevant check was not run, state that and its reason in English. Remove filler and defensive claims.

```text
fix(render): improve frame pacing and character facing

Why: Movement should read clearly while the scene renders at the selected frame budget.
Validation: Type checking and the production build passed; desktop movement was checked in the browser.
```

Use `!` after the scope for a breaking change and describe the impact and migration in a `BREAKING CHANGE:` footer:

```text
feat(protocol)!: replace absolute movement with directional input

Why: The server needs to calculate movement from validated input.
Validation: Rule tests cover normalized input and stale sequence rejection.

BREAKING CHANGE: Clients must send a direction vector and a monotonic sequence number.
```

The checker enforces the format, required sections, length, and printable ASCII text. Reviewers check English meaning and whether the validation claims match the evidence. Use plain ASCII punctuation in commit messages. Git's default `#` comment lines are ignored. Generated merge or revert titles must be rewritten to this format.

## Local hook

Enable the checked-in [commit-msg hook](https://git-scm.com/docs/githooks#_commit_msg) once in your own clone:

```sh
git config --local core.hooksPath .githooks
```

The hook uses Git and native Node.js without an additional npm dependency. Each clone configures its own hooks. Check the validator or a prepared message directly with:

```sh
node scripts/check-commit.mjs --self-test
node scripts/check-commit.mjs /absolute/path/commit-message.txt
node scripts/check-commit-history.mjs --self-test
node scripts/check-commit-history.mjs --range ROOT HEAD
node scripts/check-commit-history.mjs --range <base-commit> <head-commit>
```

## CI commit enforcement

CI fetches complete Git history and runs the same message validator against actual introduced commits, including their complete subject, body, and footers. On a push it checks commits reachable from the event's `after` SHA and absent from its `before` SHA. An initial push or a new branch has an all-zero `before` SHA, so CI checks that new ref's complete ancestry; deletion events have no commits to check. Force updates use the same ancestry difference and do not require the old tip to be an ancestor of the new tip.

On a pull request CI checks the event's actual head commits that are absent from its base history. It does not validate GitHub's synthetic test-merge message; build and rule checks still use the checked-out merge result. See [GitHub's pull request event and merge-ref behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request). A merge commit authored on the contributor's branch remains part of the checked history and must follow the repository format. Missing base/head objects fail with a history-fetch diagnostic, rather than silently skipping commits. No local hooks, history rewrites, or extra npm dependencies are needed for this CI check.

Failures identify the commit SHA, subject, and each violated rule. Self-tests exercise native temporary Git histories, non-English subjects and bodies, ordinary and force-update ranges, zero-SHA new refs, deletion, and synthetic-merge exclusion. The checker only reads the project repository; test fixtures are created in and removed from a separate temporary directory.

## Validation

```sh
npm run check
npm exec vitest run tests/rules.test.ts
npm run build
```

The GitHub workflow runs these checks, the validator and history-checker self-tests, and actual push/PR commit enforcement on Node.js 24. `npm run test` also includes PostgreSQL and LiveKit integration tests; `npm run test:e2e` covers browser flows. Run those locally when the change affects their behavior, with the services described in the local development guide. Report the commands and results in the commit body or pull request.
