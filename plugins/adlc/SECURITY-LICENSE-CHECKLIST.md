# Security and license checklist (goal 8)

Status legend: [ ] not started · [~] in progress · [x] done (date)

## Security
- [ ] No credentials, tokens or tenant identifiers committed anywhere in `plugins/adlc/` (grep + hook `guard-secrets-and-state`).
- [ ] Every hook fails closed (parse error → deny) and has a documented bypass path (none for `terraform apply`).
- [ ] MCP servers declared in `.mcp.json` use OAuth or the user's existing CLI auth; no static secrets in the file.
- [ ] Azure MCP restricted to read-only namespaces; infra mutations only via Terraform under hooks.
- [ ] Scripts under `scripts/` and `hooks/` pass `shellcheck` and `bash -n`.
- [ ] Data-handling note in README reviewed.

## License
- [ ] Repository LICENSE chosen and committed (decision pending: owner's call).
- [ ] `license` field set in `plugin.json` once chosen.
- [ ] Third-party content (templates copied from vendor docs) attributed in `docs/REVIEW-PACKET.md`.
