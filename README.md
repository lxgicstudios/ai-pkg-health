# ai-pkg-health

Analyze your package.json health. Find issues, get recommendations, optimize dependencies.

## Install & Run

```bash
npx ai-pkg-health
```

## What It Checks

- **Required fields**: name, version, description, main, license
- **Recommended fields**: author, repository, keywords, engines
- **Problematic packages**: deprecated, vulnerable, or unnecessary deps
- **Overlapping packages**: multiple HTTP clients, date libs, etc
- **Version issues**: wildcards, git URLs, local paths
- **Duplicate dependencies**: same package in deps and devDeps
- **Package count**: flags when you have too many deps

## Usage

```bash
# Analyze current directory
npx ai-pkg-health

# Analyze specific directory
npx ai-pkg-health -d ./my-project

# Skip AI recommendations
npx ai-pkg-health --no-ai

# JSON output
npx ai-pkg-health --json
```

## Example Output

```
📦 Package Health Check

✓ Loaded: my-app@1.0.0

🏥 Health Score: 72/100

❌ Errors (2):
   • moment@* is in both dependencies and devDependencies
   • Unsafe version: lodash@* - pin to specific version

⚠️  Warnings (4):
   • moment: Use date-fns or dayjs instead (smaller)
   • Overlapping packages: axios, got - consider using just one
   • Missing recommended field: engines
   • Missing recommended field: repository

ℹ️  Info (2):
   • Consider adding a "lint" script
   • 5 packages have updates available

🤖 AI Recommendations:

1. **Priority Fixes:**
   - Pin lodash to a specific version (security risk)
   - Remove moment from devDeps (it's already in deps)
   - Add `engines` field to specify Node version

2. **Quick Wins:**
   - Replace moment with dayjs (90% smaller)
   - Remove got since you already have axios
   - Add repository field for npm discoverability
```

## Detected Problematic Packages

The tool flags these common issues:
- `moment` → dayjs/date-fns
- `request` → axios/got/fetch
- `lodash` → native methods or lodash-es
- `node-fetch` → native fetch (Node 18+)
- `uuid` → crypto.randomUUID() (Node 19+)
- `colors` → chalk (security)

## FAQ

### What is a good health score?

90+ is excellent. 70-89 is healthy. Below 70 means you have issues worth fixing. The score considers security, maintenance, and best practices.

### Does it check for vulnerabilities?

It flags known problematic packages but doesn't run a full vulnerability scan. Use `npm audit` alongside this tool for security checks.

### Can I customize the rules?

Not yet. Custom rule configuration is planned. Open an issue to request specific rules.

### Why does it flag moment.js?

moment.js is 300KB+ and in maintenance mode. Modern alternatives like dayjs (2KB) or date-fns (tree-shakable) are better for new projects.

## License

MIT - Built by [LXGIC Studios](https://github.com/lxgicstudios)
