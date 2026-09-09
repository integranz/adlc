# adlc marketplace

Source and marketplace for the **adlc** (Agentic Delivery Lifecycle) Claude Code plugin.

- Plugin: [`plugins/adlc`](plugins/adlc/README.md)
- Option registry: [`plugins/adlc/templates/common/adlc/options.yaml`](plugins/adlc/templates/common/adlc/options.yaml)
- Goal evidence docs: [`docs/`](docs/)

## Use the marketplace
```
/plugin marketplace add <github-owner>/adlc
/plugin install adlc@adlc-marketplace
```

## Develop
```
npm ci
npm run validate:config-example
npm run validate:plugin        # needs the claude CLI
claude --plugin-dir ./plugins/adlc
```
Releases: semantic-release on `main` from Conventional Commits; `plugins/adlc/.claude-plugin/plugin.json` and `plugins/adlc/CHANGELOG.md` are updated automatically.
