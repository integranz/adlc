#!/usr/bin/env bash
# Branch tests for the adlc guard hooks. Exit non-zero on any failed expectation.
set -u
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"; P="$(dirname "$H")"
pass=0; fail=0
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
git -C "$T" init -q -b main; mkdir -p "$T/infra/foundation" "$T/infra/app" "$T/.github/workflows"
printf 'plan' > "$T/infra/foundation/tfplan.dev"; printf 'plan' > "$T/infra/app/tfplan.dev"
printf '.adlc/approvals/\n*.tfvars\n!*.tfvars.example\ntfplan*\n' > "$T/.gitignore"; git -C "$T" add .gitignore; git -C "$T" -c user.email=t@t -c user.name=t commit -qm init

json_bash() { # cmd cwd [agent_type]
  python3 -c 'import json,sys; d={"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}
if len(sys.argv)>3 and sys.argv[3]: d["agent_type"]=sys.argv[3]
print(json.dumps(d))' "$1" "$2" "${3:-}"; }
json_write() { python3 -c 'import json,sys; print(json.dumps({"hook_event_name":"PreToolUse","tool_name":sys.argv[1],"tool_input":{"file_path":sys.argv[2],"content":sys.argv[3]},"cwd":sys.argv[4]}))' "$1" "$2" "$3" "$4"; }
json_mcp() { python3 -c 'import json,sys; print(json.dumps({"hook_event_name":"PreToolUse","tool_name":"mcp__plugin_adlc_github__actions_run_trigger","tool_input":{"method":"run_workflow","workflow_id":sys.argv[1],"ref":"main","inputs":{"tag":sys.argv[2],"environment":"dev"}},"cwd":"/tmp"}))' "$1" "$2"; }

expect() { # name script expected_exit json [expect_stdout_regex]
  local name="$1" script="$2" want="$3" input="$4" outre="${5:-}"
  out="$(printf '%s' "$input" | bash "$H/$script" 2>/tmp/adlc_hook_err)"; got=$?
  if [ "$got" = "$want" ] && { [ -z "$outre" ] || printf '%s' "$out" | grep -Eq "$outre"; }; then pass=$((pass+1)); printf '  ok   %-58s exit %s\n' "$name" "$got"
  else fail=$((fail+1)); printf '  FAIL %-58s want %s got %s\n' "$name" "$want" "$got"; sed 's/^/       stderr: /' /tmp/adlc_hook_err | head -3; [ -n "$out" ] && printf '       stdout: %s\n' "$out" | head -2; fi
}

echo "guard-terraform-apply"
expect "plan is allowed"                      guard-terraform-apply.sh 0 "$(json_bash 'terraform plan -out=tfplan.dev' "$T/infra/foundation")"
expect "validate/fmt allowed"                 guard-terraform-apply.sh 0 "$(json_bash 'terraform fmt -check && terraform validate' "$T/infra/foundation")"
expect "apply without planfile denied"        guard-terraform-apply.sh 2 "$(json_bash 'terraform apply' "$T/infra/foundation")"
expect "apply -auto-approve denied"           guard-terraform-apply.sh 2 "$(json_bash 'terraform apply -auto-approve tfplan.dev' "$T/infra/foundation")"
expect "destroy denied"                       guard-terraform-apply.sh 2 "$(json_bash 'terraform destroy' "$T/infra/foundation")"
expect "apply -destroy denied"                guard-terraform-apply.sh 2 "$(json_bash 'terraform apply -destroy tfplan.dev' "$T/infra/foundation")"
expect "apply in infra/app denied (cwd)"      guard-terraform-apply.sh 2 "$(json_bash 'terraform apply tfplan.dev' "$T/infra/app")"
expect "apply in infra/app denied (-chdir)"   guard-terraform-apply.sh 2 "$(json_bash "terraform -chdir=$T/infra/app apply tfplan.dev" "$T")"
expect "apply with planfile, no approval"     guard-terraform-apply.sh 2 "$(json_bash 'terraform apply tfplan.dev' "$T/infra/foundation")"
expect "agent cannot self-approve"            guard-terraform-apply.sh 2 "$(json_bash "bash $P/scripts/approve-apply.sh tfplan.dev && terraform apply tfplan.dev" "$T/infra/foundation")"
bash "$P/scripts/approve-apply.sh" "$T/infra/foundation/tfplan.dev" >/dev/null
expect "apply with valid human approval"      guard-terraform-apply.sh 0 "$(json_bash 'terraform apply tfplan.dev' "$T/infra/foundation")" '"permissionDecision":"allow"'
expect "approval is single-use"               guard-terraform-apply.sh 2 "$(json_bash 'terraform apply tfplan.dev' "$T/infra/foundation")"
ADLC_APPROVAL_TTL=-5 bash "$P/scripts/approve-apply.sh" "$T/infra/foundation/tfplan.dev" >/dev/null
expect "expired approval denied"              guard-terraform-apply.sh 2 "$(json_bash 'terraform apply tfplan.dev' "$T/infra/foundation")"
expect "chained cd && apply still caught"     guard-terraform-apply.sh 2 "$(json_bash 'cd infra/foundation && terraform apply -auto-approve' "$T")"
expect "cd infra/app && apply denied (layer)"  guard-terraform-apply.sh 2 "$(json_bash 'cd infra/app && terraform apply tfplan.dev' "$T")"
expect "cd foundation && apply, no approval"   guard-terraform-apply.sh 2 "$(json_bash 'cd infra/foundation && terraform apply tfplan.dev' "$T")"
bash "$P/scripts/approve-apply.sh" "$T/infra/foundation/tfplan.dev" >/dev/null
expect "cd foundation && apply, approved"      guard-terraform-apply.sh 0 "$(json_bash 'cd infra/foundation && terraform apply tfplan.dev' "$T")" '"permissionDecision":"allow"'
bash "$P/scripts/approve-apply.sh" "$T/infra/foundation/tfplan.dev" >/dev/null
expect "cd infra; cd foundation; apply ok"     guard-terraform-apply.sh 0 "$(json_bash 'cd infra; cd foundation; terraform apply tfplan.dev' "$T")" '"permissionDecision":"allow"'
expect "cd app quoted && apply denied"         guard-terraform-apply.sh 2 "$(json_bash "cd \"$T/infra/app\" && terraform apply tfplan.dev" "/tmp")"
expect "env prefix stripped"                  guard-terraform-apply.sh 2 "$(json_bash 'TF_LOG=debug terraform apply' "$T/infra/foundation")"

echo "guard-secrets-and-state"
printf 'x' > "$T/secrets.tfvars"; printf 'x' > "$T/dev.tfvars.example"; printf 'x' > "$T/main.tf"; printf 'x' > "$T/.env"; printf 'x' > "$T/terraform.tfstate"
expect "git add main.tf allowed"              guard-secrets-and-state.sh 0 "$(json_bash 'git add main.tf' "$T")"
expect "git add tfvars denied"                guard-secrets-and-state.sh 2 "$(json_bash 'git add secrets.tfvars' "$T")"
expect "git add tfvars.example allowed"       guard-secrets-and-state.sh 0 "$(json_bash 'git add dev.tfvars.example' "$T")"
expect "git add .env denied"                  guard-secrets-and-state.sh 2 "$(json_bash 'git add .env' "$T")"
expect "git add tfstate denied"               guard-secrets-and-state.sh 2 "$(json_bash 'git add terraform.tfstate' "$T")"
expect "git add -A with .env present denied"  guard-secrets-and-state.sh 2 "$(json_bash 'git add -A' "$T")"
expect "git commit -am with .env denied"      guard-secrets-and-state.sh 2 "$(json_bash 'git commit -am "x"' "$T")"
expect "git -C dir add tfstate denied"        guard-secrets-and-state.sh 2 "$(json_bash "git -C $T add terraform.tfstate" "/tmp")"
expect "git status allowed"                   guard-secrets-and-state.sh 0 "$(json_bash 'git status' "$T")"
rm -f "$T/.env" "$T/terraform.tfstate" "$T/secrets.tfvars"
expect "git add -A clean tree allowed"        guard-secrets-and-state.sh 0 "$(json_bash 'git add -A' "$T")"
expect "tf literal client_secret denied"      guard-secrets-and-state.sh 2 "$(json_write Write "$T/infra/foundation/main.tf" 'client_secret = "Q~8superSecretValue123456"' "$T")"
expect "tf var reference allowed"             guard-secrets-and-state.sh 0 "$(json_write Write "$T/infra/foundation/main.tf" 'client_secret = var.client_secret' "$T")"
expect "tf key vault ref allowed"             guard-secrets-and-state.sh 0 "$(json_write Edit "$T/infra/app/main.tf" 'key_vault_secret_id = azurerm_key_vault_secret.db.id' "$T")"
expect "workflow secrets ref allowed"         guard-secrets-and-state.sh 0 "$(json_write Write "$T/.github/workflows/ci.yml" 'password: ${{ secrets.ACR_PASSWORD }}' "$T")"
expect "workflow literal token denied"        guard-secrets-and-state.sh 2 "$(json_write Write "$T/.github/workflows/ci.yml" 'token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij1234"' "$T")"
expect "private key in tf denied"             guard-secrets-and-state.sh 2 "$(json_write Write "$T/infra/foundation/x.tf" '-----BEGIN RSA PRIVATE KEY-----' "$T")"
expect "app source file not inspected"        guard-secrets-and-state.sh 0 "$(json_write Write "$T/apps/api/Program.cs" 'var password = "not-infra-file-1234567";' "$T")"

echo "guard-immutable-tags"
expect "push semver allowed"                  guard-immutable-tags.sh 0 "$(json_bash 'docker push acradlc.azurecr.io/adlc-demo/api:1.2.3' /tmp)"
expect "push sha tag allowed"                 guard-immutable-tags.sh 0 "$(json_bash 'docker push acradlc.azurecr.io/adlc-demo/api:sha-9d1dc0e' /tmp)"
expect "push latest denied"                   guard-immutable-tags.sh 2 "$(json_bash 'docker push acradlc.azurecr.io/adlc-demo/api:latest' /tmp)"
expect "push untagged denied"                 guard-immutable-tags.sh 2 "$(json_bash 'docker push acradlc.azurecr.io/adlc-demo/api' /tmp)"
expect "push registry:port untagged denied"   guard-immutable-tags.sh 2 "$(json_bash 'docker push localhost:5000/api' /tmp)"
expect "push dev denied"                      guard-immutable-tags.sh 2 "$(json_bash 'docker build -t x:1.0 . && docker push acr.io/x:dev' /tmp)"
expect "build latest warns, allowed"          guard-immutable-tags.sh 0 "$(json_bash 'docker build -t api:latest .' /tmp)" 'systemMessage'
expect "az acr build latest denied"           guard-immutable-tags.sh 2 "$(json_bash 'az acr build -r acradlc --image adlc-demo/api:latest .' /tmp)"
expect "az acr build semver allowed"          guard-immutable-tags.sh 0 "$(json_bash 'az acr build -r acradlc --image adlc-demo/api:1.2.3 .' /tmp)"
expect "gh run cd without tag denied"         guard-immutable-tags.sh 2 "$(json_bash 'gh workflow run cd.yml -f environment=dev' /tmp)"
expect "gh run cd tag=latest denied"          guard-immutable-tags.sh 2 "$(json_bash 'gh workflow run cd.yml -f tag=latest -f environment=dev' /tmp)"
expect "gh run cd tag=semver allowed"         guard-immutable-tags.sh 0 "$(json_bash 'gh workflow run cd.yml -f tag=1.2.3 -f environment=dev' /tmp)"
expect "gh run ci without tag allowed"        guard-immutable-tags.sh 0 "$(json_bash 'gh workflow run ci.yml' /tmp)"
expect "terraform -var image_tag=latest deny" guard-immutable-tags.sh 2 "$(json_bash 'terraform plan -var image_tag=latest' /tmp)"
expect "TF_VAR_image_tag=main denied"         guard-immutable-tags.sh 2 "$(json_bash 'TF_VAR_image_tag=main terraform plan' /tmp)"
expect "mcp run_workflow cd tag=latest deny"  guard-immutable-tags.sh 2 "$(json_mcp cd.yml latest)"
expect "mcp run_workflow cd tag=semver allow" guard-immutable-tags.sh 0 "$(json_mcp cd.yml 1.2.3)"
expect "mcp run_workflow ci no tag allowed"   guard-immutable-tags.sh 0 "$(python3 -c 'import json;print(json.dumps({"tool_name":"mcp__plugin_adlc_github__actions_run_trigger","tool_input":{"method":"run_workflow","workflow_id":"ci.yml","ref":"main","inputs":{}}}))')"

echo "guard-readonly-agents"
expect "explore: git status allowed"          guard-readonly-agents.sh 0 "$(json_bash 'git status && grep -rn TODO .' "$T" explore)"
expect "explore: git commit denied"           guard-readonly-agents.sh 2 "$(json_bash 'git commit -m x' "$T" explore)"
expect "verify: terraform plan allowed"       guard-readonly-agents.sh 0 "$(json_bash 'terraform plan -detailed-exitcode' "$T" adlc:verify)"
expect "verify: docker push denied"           guard-readonly-agents.sh 2 "$(json_bash 'docker push x:1.0' "$T" verify)"
expect "verify: curl GET allowed"             guard-readonly-agents.sh 0 "$(json_bash 'curl -fsS https://example.com/health' "$T" verify)"
expect "verify: az show allowed"              guard-readonly-agents.sh 0 "$(json_bash 'az containerapp show -n api -g rg' "$T" verify)"
expect "verify: az create denied"             guard-readonly-agents.sh 2 "$(json_bash 'az group create -n rg -l westeurope' "$T" verify)"
expect "verify: redirect to file denied"      guard-readonly-agents.sh 2 "$(json_bash 'echo hi > notes.txt' "$T" verify)"
expect "verify: redirect to /dev/null allowed" guard-readonly-agents.sh 0 "$(json_bash 'ls > /dev/null 2>&1' "$T" verify)"
expect "execute: git commit allowed"          guard-readonly-agents.sh 0 "$(json_bash 'git commit -m x' "$T" execute)"
expect "verify: mcp createJiraIssue denied"    guard-readonly-agents.sh 2 "$(python3 -c 'import json;print(json.dumps({"tool_name":"mcp__plugin_adlc_atlassian__createJiraIssue","tool_input":{},"agent_type":"adlc:verify"}))')"
expect "verify: mcp getJiraIssue allowed"       guard-readonly-agents.sh 0 "$(python3 -c 'import json;print(json.dumps({"tool_name":"mcp__plugin_adlc_atlassian__getJiraIssue","tool_input":{},"agent_type":"verify"}))')"
expect "explore: mcp actions_run_trigger denied" guard-readonly-agents.sh 2 "$(python3 -c 'import json;print(json.dumps({"tool_name":"mcp__github__actions_run_trigger","tool_input":{"method":"run_workflow"},"agent_type":"explore"}))')"
expect "verify: mcp get_job_logs allowed"       guard-readonly-agents.sh 0 "$(python3 -c 'import json;print(json.dumps({"tool_name":"mcp__github__get_job_logs","tool_input":{},"agent_type":"verify"}))')"
expect "verify: heredoc allowed"                guard-readonly-agents.sh 0 "$(json_bash $'cat <<EOF\nhello\nEOF' "$T" verify)"
expect "verify: 2>&1 allowed"                   guard-readonly-agents.sh 0 "$(json_bash 'terraform plan 2>&1 | tail -5' "$T" verify)"
expect "no agent: unaffected"                 guard-readonly-agents.sh 0 "$(json_bash 'rm -rf build' "$T")"

echo; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
