# The mod's checks: what CI runs (.github/workflows/check.yml).
check: typecheck lint size test

# tsc, strict (tsconfig.json)
typecheck:
    node_modules/.bin/tsc -p tsconfig.json

# oxlint with anti-slop (oxlint.config.ts)
lint *args:
    node_modules/.bin/oxlint --deny-warnings {{args}} mod

# a file under 750 lines, a function at 80 code lines or fewer
size:
    node_modules/.bin/oxlint --deny-warnings -c oxlint.size.json mod

# the bun tests, against the fake kubectl and stand-ins for Fireflies
test:
    bun test test

# the typings, from the Fireflies on PATH (after each Fireflies update)
types:
    herdr-app types types && rm -f types/jsconfig.json types/tsconfig.json
