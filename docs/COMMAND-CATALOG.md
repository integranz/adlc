# Command catalog (goal 3)

Five user-invoked skills (`disable-model-invocation: true`), each with arguments, defaults and a safety note. Invoke as `/adlc:<name>` once the plugin is installed. Status: 2 of 5 implemented.

| # | Command | Arguments | Defaults | Safety | Status | Example |
|---|---|---|---|---|---|---|
| 1 | `/adlc:dockerize` | `$0` app path or name; `--no-run`, `--compose`, `--force` | version from the configured versioning tool (`nbgv get-version -v SemVer2`), else `0.0.0-local`; local tag `<project>/<app>:<version>` | never pushes, never tags `latest`, never edits generated files, stops its containers, distroless runtime stays untouched | **implemented, exercised 2026-09-14** (`adlc-demo/api:0.1.6`) | `/adlc:dockerize apps/api` |
| 2 | `/adlc:plan` | `$0` env; `--layer foundation\|app`; `--image-tag` (app) | `dev`, `foundation`; `ARM_SUBSCRIPTION_ID` from `az account show` | plan only, never applies or formats in place; prints the human approval protocol; plan file gitignored and hook-protected | **implemented, exercised 2026-09-14** (`adlc-demo` foundation: 8 to add) | `/adlc:plan dev --layer foundation` |
| 3 | `/adlc:deploy` | `$0` tag; `$1` env | latest green CI tag on the default branch; `dev` | immutable tag required (hook), environment approval gate | stub | `/adlc:deploy 0.1.6 dev` |
| 4 | `/adlc:verify` | `$0` env; `$1` tag | — | read-only; writes only `.adlc/evidence/<tag>.md` | stub | `/adlc:verify dev 0.1.6` |
| 5 | `/adlc:ticket` | `$0` action; `$1` key; `--evidence <file>` | project/transitions from `.adlc/config.yaml` | never fabricates keys; delete/manage disabled | stub | `/adlc:ticket create` |
