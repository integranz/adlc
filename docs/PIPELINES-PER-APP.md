# Design: one CI and one CD per app (change request 2026-09-17)

Status: **approved design, implementation in progress** (target plugin 0.13.0; demo cutover with human-gated applies).

## Requirements (from the user)

1. Every app has its own CI and CD workflow; nothing is combined across apps.
2. Workflow names are `<prefix>-<app>-ci` and `<prefix>-<app>-cd`; the prefix defaults to the repository name (project-qualified, like the reference monorepo).
3. In a monorepo a change triggers only the apps it touches.
4. Every app has its own `version.json` whose `pathFilters` include its own artifact inputs.
5. Shared artifacts trigger every app that uses them and bump each of those versions.
6. CD may start automatically when the app's CI succeeds on the default branch (option); the environment approval gate still applies.
7. Terraform: one root module per app (`infra/apps/<app>`) with its own state, so one app's deploy never plans another app's image.
8. Tags: `release.tagName = "<app>/v{version}"`; image tags stay `<repository>:<semver>` because the repository already identifies the app.
9. semantic-release in a monorepo stays a **planned** option (single-app repositories keep it implemented).

## Single source of truth

`.slipway/config.yaml` gains:

```yaml
options:
  cd_trigger: on-ci-success      # manual | on-ci-success
  pr_checks: path-filtered       # path-filtered (implemented) | always-run-gate (later)
pipelines:
  name_prefix: slipway-demo      # default github.repo
shared_paths: []                 # repo-level inputs of every app (shared workflows are added automatically)
apps:
  - name: api
    path: apps/api
    paths: [libs/dotnet/Demo.Contracts]   # extra build inputs; .NET ProjectReferences outside the app are detected and must be listed
```

From that one list the scaffold renders, per app:

- `apps/<app>/version.json` (`pathFilters` as repo-root paths, `release.tagName`),
- `.github/workflows/<prefix>-<app>-ci.yml` with `on.push.paths` and `on.pull_request.paths`,
- `.github/workflows/<prefix>-<app>-cd.yml` (`workflow_dispatch` + optional `workflow_run` on the app's CI),
- `infra/apps/<app>/` root module (state key `<project>/apps/<app>/<env>.tfstate`).

The per-app path list = app path + `paths` + `shared_paths` + the four workflow files + `infra/apps/<app>` (+ root `.dockerignore` when the Docker build context is the repository root). `verify` gets a claim that the rendered triggers and `pathFilters` still agree.

## Workflows

- `_ci.yml` and `_cd.yml` are reusable workflows (`on: workflow_call`) generated into the repo; each `<prefix>-<app>-ci.yml` is a thin caller (`uses: ./.github/workflows/_ci.yml`, `secrets: inherit`). A central pipelines repository is a later option.
- CI per app: version (`dotnet/nbgv` with `path: <app path>`), test (that app only), image (immutable-tag guard, push on the default branch only, local build on pull requests), release (`nbgv tag` on the app's version.json → `<app>/v<version>`, manifest artifact `release-manifest-<app>-<version>`).
- CD per app: `plan` (validate tag, image exists, `terraform plan` in `infra/apps/<app>`) → `apply` behind the GitHub environment → smoke test of that app. With `cd_trigger: on-ci-success` the CD also has `on: workflow_run` for its own CI on the default branch; the tag is read from the triggering run's manifest artifact, so no input is needed. Target is `github.cd_environment`; the reviewer still approves.

## Terraform

- The Container Apps environment moves from `infra/app` to `infra/foundation` (it is shared by all apps). `infra/apps/<app>` looks everything up by name and owns exactly one `azurerm_container_app`.
- Cutover of an existing repo (the demo): `import` blocks bring the environment into foundation state and each container app into its app state; the old `infra/app` state is emptied with `terraform state rm` and the directory removed. Every apply passes the existing gates (human token locally for foundation, environment approval in CD).

## Known GitHub caveats (verified in the docs)

- A workflow skipped by `paths` leaves its checks **Pending**; a branch rule that requires such a check blocks every pull request that does not touch that app. Default: no required per-app checks. `pr_checks: always-run-gate` (later) would add a tiny always-running job per app that reports success when the app is untouched.
- Push diffs are two-dot, pull-request diffs are three-dot; diffs over 3,000 files may not match the filter.
- `workflow_run` cannot carry inputs; the tag is recovered from the CI run's artifact instead.

## Skill surface

`/slipway:deploy <app> <tag> [env]`, `/slipway:verify <app> <env> <tag>`, `/slipway:plan <env> --layer foundation|apps/<app>`; evidence at `.slipway/evidence/<app>/<tag>.md`. `dockerize` and `ticket` unchanged.
