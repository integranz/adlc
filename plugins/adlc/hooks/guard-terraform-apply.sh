#!/usr/bin/env bash
# Guardrail 1: no `terraform apply` without explicit human approval; never destroy; never -auto-approve;
# never apply the infra/app layer from a session (CD only).
# Approval = one-shot token written by a human with scripts/approve-apply.sh <planfile> (10 min TTL).
# Rationale: a hook "ask" decision becomes "allow" in headless (-p) sessions, so a UI prompt is not a gate.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

tool="$(hook_json tool_name)"; [ "$tool" = "Bash" ] || exit 0
raw="$(hook_json tool_input.command)"; cmd="$(normalize_cmd "$raw")"
cwd="$(hook_json cwd)"; [ -n "$cwd" ] || cwd="$PWD"

# Fast path: nothing terraform-ish
printf '%s' "$cmd" | grep -Eq '(^|[;&|(`[:space:]])terraform([[:space:]]|$)' || exit 0
# The agent must never mint its own approval
printf '%s' "$cmd" | grep -Eq 'approve-apply' && deny "Approval tokens are created by a human in a separate terminal, never from an agent session."

# Only apply/destroy are gated; plan/validate/fmt/init/show/output are fine
printf '%s' "$cmd" | grep -Eq 'terraform([[:space:]]+-[^[:space:]]+)*[[:space:]]+(apply|destroy)([[:space:]]|$)' || exit 0

printf '%s' "$cmd" | grep -Eq 'terraform([[:space:]]+-[^[:space:]]+)*[[:space:]]+destroy' && deny "terraform destroy is never run from an agent session. A human runs it deliberately, outside Claude, after review."
printf '%s' "$cmd" | grep -Eq '(-auto-approve|-refresh-only[[:space:]]+-auto-approve)' && deny "terraform apply -auto-approve is forbidden. Create a plan file (/adlc:plan), have a human approve it (scripts/approve-apply.sh), then apply that exact plan file."
printf '%s' "$cmd" | grep -Eq -- '-destroy([[:space:]]|$)' && deny "terraform apply -destroy is forbidden from an agent session."

# Effective working directory: follow leading `cd <dir> &&` / `cd <dir>;` / `pushd <dir> &&` chains, then -chdir=<dir> wins
dir="$cwd"; rest="$cmd"
while printf '%s' "$rest" | grep -Eq '^(cd|pushd)[[:space:]]+[^;&|]+[[:space:]]*(&&|;)'; do
  target="$(printf '%s' "$rest" | sed -E 's/^(cd|pushd)[[:space:]]+([^;&|]+)[[:space:]]*(&&|;).*/\2/' | sed -E 's/^["'"'"']//; s/["'"'"'][[:space:]]*$//; s/[[:space:]]+$//')"
  case "$target" in /*) dir="$target";; "~"|"~/"*) dir="$HOME${target#\~}";; *) dir="$dir/$target";; esac
  rest="$(printf '%s' "$rest" | sed -E 's/^(cd|pushd)[[:space:]]+[^;&|]+[[:space:]]*(&&|;)[[:space:]]*//')"
done
chdir="$(printf '%s' "$cmd" | grep -Eo -- '-chdir=[^[:space:]]+' | head -1 | cut -d= -f2- || true)"
if [ -n "$chdir" ]; then case "$chdir" in /*) dir="$chdir";; *) dir="$dir/$chdir";; esac; fi
dir="$(cd "$dir" 2>/dev/null && pwd -P || printf '%s' "$dir")"

case "$dir" in *"/infra/app"|*"/infra/app/"*) deny "The infra/app layer is applied only by the CD workflow behind the environment approval gate. Use /adlc:deploy <tag> <env> instead of applying it here.";; esac

# Plan file = last token after 'apply' that is not a flag
planfile="$(printf '%s' "$cmd" | sed -E 's/.*terraform([[:space:]]+-[^[:space:]]+)*[[:space:]]+apply[[:space:]]*//' | tr ' ' '\n' | grep -Ev '^-|^$|^&&|^;|^\|' | tail -1 || true)"
[ -n "$planfile" ] || deny "terraform apply needs a saved plan file. Run /adlc:plan <env> --layer foundation, review the plan, then a human approves it with: bash \"\${CLAUDE_PLUGIN_ROOT}/scripts/approve-apply.sh\" <planfile>"
case "$planfile" in /*) planpath="$planfile";; *) planpath="$dir/$planfile";; esac
[ -f "$planpath" ] || deny "Plan file '$planfile' does not exist in $dir. Re-run /adlc:plan and apply the exact plan file it produced."

root="$(repo_root "$dir")"; sha="$(sha256_file "$planpath")"; token="$root/.adlc/approvals/$sha"
[ -f "$token" ] || deny "No human approval found for plan '$planfile'.
A human (not the agent) must run, in a separate terminal:
  bash <plugin-root>/scripts/approve-apply.sh $planpath
The approval is single-use and expires after 10 minutes. Then re-run this exact apply command."
expiry="$(sed -n '2p' "$token" | tr -dc '0-9')"; now="$(date +%s)"
if [ -z "$expiry" ] || [ "$now" -gt "$expiry" ]; then rm -f "$token"; deny "Approval for '$planfile' has expired (10 min TTL). Ask the human to approve again."; fi
rm -f "$token"   # single use
allow_with_reason "Human-approved plan $planfile (sha256 ${sha:0:12}) applied once; approval consumed."
