set dotenv-load
# Preserve native status and positional argv through PowerShell's scriptblock invocation.
set windows-shell := ["pwsh.exe", "-NoLogo", "-CommandWithArgs", "$ErrorActionPreference = 'Stop'; $justRecipeArgs = @($args | Select-Object -Skip 1); & ([scriptblock]::Create($args[0])) @justRecipeArgs; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }"]

# Native argv forwarding uses shell positional parameters without reconstructing command strings.
recipe_args := if os() == "windows" { "@($args | Select-Object -Skip 1)" } else { '"$@"' }

# Install pinned mise tools and workspace dependencies.
setup:
    mise install
    pnpm install

# Build workspace packages through the Turbo dependency graph and local cache.
build:
    pnpm build

# Typecheck the TypeScript project graph.
typecheck:
    pnpm typecheck

# Check formatting, recommended lint rules, and import organization with Biome.
[positional-arguments]
lint *args:
    pnpm lint {{recipe_args}}

# Apply Biome formatting, import organization, and safe lint fixes.
[positional-arguments]
format *args:
    pnpm format {{recipe_args}}

# Run Vitest with graph-scheduled builds. Filter with --project unit, integration, or e2e.
# Slice a CI run with --shard=1/N; each slice still waits for one cached ^build.
[positional-arguments]
test *args:
    pnpm test {{recipe_args}}

# Schedule lint, build, typecheck, tests, docs, and release checks through Turbo.
check:
    pnpm check

# Run the built CLI. Build first. Arguments are forwarded as native argv.
[positional-arguments]
cli *args:
    node apps/cli/dist/main.js {{recipe_args}}

# Run the built daemon. Build first. Arguments are forwarded as native argv.
[positional-arguments]
daemon *args:
    node apps/daemon/dist/main.js {{recipe_args}}

# Run repository tooling. Build first. Arguments are forwarded as native argv.
[positional-arguments]
dev-cli *args:
    node scripts/dev-cli/dist/main.js {{recipe_args}}
