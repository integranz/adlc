# Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-09-09 | Plugin name `adlc`, marketplace name `adlc-marketplace`, skills invoked as `/adlc:<skill>` (bootstrap, dockerize, plan, deploy, verify, ticket) | Plugin skills are namespaced by plugin name; prefixing skills with `adlc-` would read `/adlc:adlc-bootstrap`. Note: the official Anthropic marketplace once had a plugin named `adlc` (renamed `agentforce-adlc`, Salesforce). Names are scoped per marketplace, so no technical conflict, but the review packet should mention it. |
| 2026-09-09 | This repo versions itself with semantic-release; `adlc-demo` uses NBGV | Proves both versioning options on real repos without running two schemes on one repo. |
| 2026-09-09 | Option registry (`options.yaml`) with `implemented / planned / later` status is the single source of truth for the interview | User requirement: every "now vs later" choice is the end user's, the system supports the alternatives. |
| 2026-09-09 | Repository LICENSE not yet chosen | Owner's call; required before marketplace review (see SECURITY-LICENSE-CHECKLIST.md). |
| 2026-09-09 | Skill namespacing confirmed by a headless `claude -p --plugin-dir` run: model-invocable skills appear as `adlc:bootstrap`, `adlc:delivery-knowledge`; command skills (`disable-model-invocation: true`) are hidden from the model and user-invoked as `/adlc:<name>` | Spike result; matches docs. |
| 2026-09-09 | DHI .NET 8 tag availability **unverified**: `docker manifest inspect dhi.io/...` returns `unauthorized` anonymously; catalog pages list only recently pushed 10.x images. Fallback verified: `mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled` and `mcr.microsoft.com/dotnet/sdk:8.0` exist | Owner to run `docker login dhi.io` and re-check; if 8.0 is absent, `base_image: mcr-chiseled` becomes the implemented .NET option and `dhi` stays for nginx/node. |
| 2026-09-09 | Schema validation uses ajv 2020-12 strict mode with `strictRequired` off | Conditional `required` inside `if/then` is valid JSON Schema; the strictRequired heuristic rejects it. |
