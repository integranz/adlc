# Guardrail hooks (goal 2)

Plugin hooks live in `plugins/adlc/hooks/hooks.json` and run for every tool call in a session **and inside sub-agents** (the hook input carries `agent_type`). Contract: exit 0 = no objection (optionally a JSON decision on stdout), exit 2 = blocked with the reason on stderr shown to Claude. All guards fail closed: a parse error is a block, not a pass.

Why hooks and not rules: a rule tells the model what to do; a hook makes it impossible to do otherwise. A hook `ask` decision becomes `allow` in headless (`-p`, Routine, cloud) sessions, so none of these guards rely on a UI prompt.

Branch tests: `bash plugins/adlc/hooks/test-hooks.sh` (72 cases, run in CI by `plugin-ci.yml`). Last local run: 2026-09-09, `passed=72 failed=0`.

---

## 1. `guard-terraform-apply.sh` — no apply without a human, never destroy
| | |
|---|---|
| **Runs** | `PreToolUse`, matcher `Bash`, whenever the command contains `terraform` |
| **Blocks** | `terraform destroy`; `apply -auto-approve`; `apply -destroy`; `apply` without a saved plan file; `apply` whose plan file does not exist; any `apply` in `infra/app` (that layer is applied only by the CD workflow behind the GitHub Environment approval); `apply` of a plan file that has **no valid human approval token**; any attempt to run `approve-apply.sh` from the agent |
| **Allows** | `plan`, `validate`, `fmt`, `init`, `show`, `output`; `apply <planfile>` in `infra/foundation` when a matching approval token exists (then consumes the token) |
| **Human approval** | In a separate terminal: `bash <plugin-root>/scripts/approve-apply.sh infra/foundation/tfplan.dev`. Writes `.adlc/approvals/<sha256 of plan>` with a 10-minute expiry (`ADLC_APPROVAL_TTL` to change). Single use: the hook deletes it on the first allowed apply. A changed plan file has a different hash and needs a new approval. |
| **On failure** | Missing `jq` and `python3` → block. Unknown layout → block with instructions. Expired token → deleted and blocked. |
| **Evidence** | `test-hooks.sh` section `guard-terraform-apply` (20 cases incl. `cd … &&` chains and `-chdir=`); live headless checks 2026-09-09 on both layers (see `DECISIONS.md`) |

## 2. `guard-secrets-and-state.sh` — nothing secret reaches git or IaC
| | |
|---|---|
| **Runs** | `PreToolUse` on `Bash` (for `git add`, `git commit`, `git stage`) and on `Edit`/`Write` |
| **Blocks (git)** | staging or committing `.env*`, `*.tfvars` (except `*.example`/`.sample`/`.template`), `*.tfstate*`, `tfplan*`, `*.tfplan`, `backend.hcl`, `*.pem`, `*.p12`, `*.pfx`, `*.key`, `id_rsa*`, `id_ed25519*`. Bulk stages (`git add -A`, `git add .`, `git commit -a`) are inspected via `git status --porcelain`, honouring `.gitignore`. `git -C <dir>` is respected. |
| **Blocks (files)** | writing a secret-looking literal (`client_secret = "…"`, `password: "…"`, `token = "…"`, AWS/GitHub/Slack token shapes, JWTs, `BEGIN … PRIVATE KEY`) into `*.tf`, `*.tfvars`, `*.hcl`, `*.bicep`, Dockerfiles, or YAML/JSON under `infra/`, `terraform/`, `.github/workflows/`, `deploy/`, `k8s/`, `helm/`, `charts/`. References are allowed: `var.*`, `local.*`, `data.*`, `${{ secrets.NAME }}`, `secretref:`, `key_vault_secret_id`, `random_password`. |
| **Does not inspect** | application source files (a hard-coded credential in app code is a code-review concern, not an IaC guard) |
| **On failure** | Unparseable input → block. |
| **Evidence** | `test-hooks.sh` section `guard-secrets-and-state` (18 cases) |

## 3. `guard-immutable-tags.sh` — only immutable tags leave the machine
| | |
|---|---|
| **Runs** | `PreToolUse` on `Bash` and on MCP tools matching `actions_run_trigger` |
| **Blocks** | `docker push` with no tag or a mutable tag (`latest`, `main`, `master`, `dev`, `develop`, `staging`, `prod`, `test`, `qa`, `edge`, `nightly`, `stable`, `release` …); `az acr build|import` with a mutable/absent tag; `gh workflow run <cd|deploy|release>*` without `-f tag=<immutable>`; `terraform … -var image_tag=<mutable>` or `TF_VAR_image_tag=<mutable>`; GitHub MCP `run_workflow` on a CD/deploy/release workflow without an immutable `inputs.tag` |
| **Warns only** | local `docker build -t x:latest` (shown as a system message, not blocked) |
| **On failure** | Unparseable input → block. |
| **Evidence** | `test-hooks.sh` section `guard-immutable-tags` (18 cases) |

## 4. `guard-readonly-agents.sh` — explore and verify cannot mutate (supporting guard)
| | |
|---|---|
| **Runs** | `PreToolUse` on `Bash` and on every `mcp__*` tool, only when `agent_type` matches `explore` or `verify` |
| **Blocks** | mutating shell commands (`rm/mv/cp/chmod/tee/sed -i`, `git add/commit/push/checkout/…`, `terraform apply/destroy/import/state …`, `docker push/build/rm`, `kubectl apply/delete/…`, `helm install/upgrade`, `az … create/delete/update/set/…`, `gh workflow run/pr create/…`, package installs, `curl -X POST/PUT/PATCH/DELETE`), output redirection into files (fd duplication and `/dev/null` are fine), and MCP tools whose name implies a write (`create`, `edit`, `update`, `delete`, `transition`, `run_trigger`, …) |
| **Why** | Goal 6 says the verification role "never fixes". The agents' `tools` lists already exclude Edit/Write; this hook makes the shell and MCP side mechanical too. |
| **Evidence** | `test-hooks.sh` section `guard-readonly-agents` (16 cases) |

---

## Testing a hook on a branch
1. Edit the script; run `bash -n` and `bash plugins/adlc/hooks/test-hooks.sh`.
2. Add a case to `test-hooks.sh` for every new block/allow path (name, script, expected exit, JSON input).
3. Open a PR; `plugin-ci.yml` runs the suite. Merge only when `failed=0`.
4. For a live check: `claude -p --plugin-dir ./plugins/adlc --allowedTools "Bash(terraform *)" "run: terraform apply tfplan"` in a scratch repo; expect `adlc guard: BLOCKED`.
