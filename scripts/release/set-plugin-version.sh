#!/usr/bin/env bash
# Called by @semantic-release/exec (prepareCmd) with the next version. Writes it into plugin.json.
set -euo pipefail
version="${1:?usage: set-plugin-version.sh <semver>}"
manifest="$(dirname "$0")/../../plugins/adlc/.claude-plugin/plugin.json"
tmp="$(mktemp)"
node -e '
  const fs = require("fs"); const [,, file, version] = process.argv;
  const j = JSON.parse(fs.readFileSync(file, "utf8")); j.version = version;
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
' "$manifest" "$version"
rm -f "$tmp"
echo "plugin.json version -> $version"
