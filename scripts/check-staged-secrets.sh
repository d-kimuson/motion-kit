#!/bin/sh

if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks protect --staged --verbose --redact
fi

# Missing tooling is a local setup gap; CI remains the security backstop.
printf '%s\n' 'Warning: gitleaks not found; skipping local secret scan. Run nix develop or brew install gitleaks.' >&2
exit 0
