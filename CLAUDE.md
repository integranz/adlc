@AGENTS.md

## Non-negotiables
- Never run `terraform apply` or `terraform destroy` in this repo or a target repo without the human running the approved command.
- Never commit secrets, `*.tfvars` (other than `*.example`), state files, `.env*`, or plan files.
- Image tags are immutable semver from the configured versioning tool; never `latest` or branch names.
- Every option in `options.yaml` has a `status`; a `planned` or `later` option is never selectable in the interview.
- Use Conventional Commit messages; the release version depends on them.
- Verify before asserting: a claim about a build, deployment or ticket needs a command output or URL as evidence.
