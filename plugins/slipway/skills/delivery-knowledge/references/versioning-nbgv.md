# Versioning option `nbgv` — Nerdbank.GitVersioning

- Source of truth: `version.json` at the repository root (`version: "0.1"`, `publicReleaseRefSpec: ["^refs/heads/main$"]`). Patch = git height since the version was last changed; other branches produce prerelease versions (`0.1.7-g<sha>`) that must not be deployed beyond `dev`.
- Local: `nbgv get-version -v SemVer2` (tool installed with `dotnet tool install -g nbgv`, needs a .NET SDK). CI: `dotnet/nbgv@v0.5.2` after `actions/checkout` with `fetch-depth: 0`; outputs `SemVer2`, `SimpleVersion`, `GitCommitIdShort`, `PublicRelease`, `NpmPackageVersion`, … (`setAllVars: true` exports them as `NBGV_*` env vars).
- Images are tagged with `SemVer2`; the same value is stamped into the API (`-p:InformationalVersion`) and the web bundle (`VITE_APP_VERSION`) so `/slipway:verify` can compare the running version with the tag.
- The release job runs `nbgv tag` (creates `v<version>` on the release commit) and pushes the tag; `permissions: contents: write` is required. Bump the minor by editing `version.json` in a normal PR; never hand-write tags.
- Works for any repository (the demo's web app has no .NET code); the .NET SDK is only a build-time dependency of the tool.
- Exercised on `integranz/slipway-demo` (first CI release on 2026-09-15).
