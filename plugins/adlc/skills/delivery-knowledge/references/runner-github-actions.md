# Runner option `github-actions`

Verified 2026-09-15: action versions from each repository's latest release; runner image `ubuntu-latest` (Ubuntu 24.04) ships .NET SDK 8.0.4xx and the `nbgv` tool, but the workflow still pins them with setup actions.

## Workflow shape (rendered from `templates/runner/github-actions/files/.github/workflows/ci.yml.tmpl`)
| Job | Runs on | Does | Notes |
|---|---|---|---|
| `version` | PR + default branch | computes the release version with the configured versioning option | `fetch-depth: 0` is mandatory (git height / commit analysis) |
| `test` | PR + default branch | each app's `test_command` from `.adlc/config.yaml` | setup steps only for stacks present (`has_dotnet`, `has_node`) |
| `images` (matrix per app) | PR: build + load only; default branch: build + push | `docker/build-push-action` with `VERSION`/`COMMIT` build-args, tags `<registry>/<repo>:<semver>` and `:sha-<short>`, `provenance: false`, GHA cache per app | login to `dhi.io` for the hardened base images; `azure/login` (OIDC) + `az acr login` only on releases |
| `release` | default branch only | assembles `release-manifest.json` (version, commit, per-image digest) as an artifact, creates the git tag (`nbgv tag` + push) or runs `semantic-release` | `contents: write` is required for the tag |

## Pinned actions (latest majors on 2026-09-15)
`actions/checkout@v7`, `actions/setup-dotnet@v6`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v7`, `dotnet/nbgv@v0.5.2`, `azure/login@v3`, `docker/login-action@v4`, `docker/setup-buildx-action@v4`, `docker/build-push-action@v7`.

## Decisions baked in
- **No `workflow_run` handoff**: it cannot carry inputs. CD is a separate `workflow_dispatch` workflow that receives the tag explicitly (`/adlc:deploy`).
- **Immutable tags only**: semver + `sha-<short>`; never `latest` or branch names (the guard hook rejects them locally; the template never emits them).
- **`provenance: false`, `sbom: false`**: with attestations, buildx pushes an OCI image index and the registry digest differs from the digest of the running image. A single manifest keeps `/adlc:verify`'s "registry digest == running digest" check literal. Supply-chain attestations can be re-enabled once verification compares platform manifests.
- **OIDC only**: `permissions: id-token: write`; the CI job on the default branch presents subject `repo:<owner>/<repo>:ref:refs/heads/<default>` (federated credential `github-main`); PR builds never touch Azure.
- **Concurrency**: one CI run per ref; PR runs cancel superseded ones, release runs never cancel.
- **Registry login**: `az acr login` after `azure/login` uses the OIDC identity's `AcrPush`; no admin credentials exist (`admin_enabled = false`).

## Secrets and variables consumed
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (secrets), `DOCKERHUB_TOKEN` (secret), `DOCKERHUB_USERNAME` (variable), `GITHUB_TOKEN` (automatic). See `identity-and-secrets.md`.

## Verifying a run (`/adlc:verify`, `explore`)
`gh run list --workflow ci --branch main`, `gh run view <id>`; job summary lists the pushed tags and digests; artifact `release-manifest-<version>` is the source of truth for the deploy step. Registry side: `az acr repository show-tags -n <acr> --repository <repo>`, `az acr manifest list-metadata -r <acr> -n <repo>` for digests.
