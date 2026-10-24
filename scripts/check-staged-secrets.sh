#!/bin/sh

if ! root=$(git rev-parse --show-toplevel 2>/dev/null) || ! cd "$root"; then
  printf '%s\n' 'Error: staged secret scan must run inside a Git working tree.' >&2
  exit 1
fi

scanner=$(command -v gitleaks 2>/dev/null)
if [ -z "$scanner" ]; then
  # command -v may omit an installed scanner that lacks execute permission.
  remaining_path=${PATH-}
  while :; do
    directory=${remaining_path%%:*}
    candidate=${directory:-.}/gitleaks
    if [ -e "$candidate" ] || [ -L "$candidate" ]; then
      scanner=$candidate
      break
    fi
    case "$remaining_path" in
      *:*) remaining_path=${remaining_path#*:} ;;
      *) break ;;
    esac
  done
fi

if [ -n "$scanner" ]; then
  if [ ! -f "$scanner" ] || [ ! -x "$scanner" ]; then
    printf 'Error: gitleaks scanner is present but unrunnable: %s\n' "$scanner" >&2
    exit 126
  fi
  "$scanner" protect --staged --verbose --redact
  status=$?
  case "$status" in
    126|127) printf 'Error: gitleaks scanner is present but unrunnable: %s\n' "$scanner" >&2 ;;
  esac
  exit "$status"
fi

# Missing tooling is a local setup gap; CI remains the security backstop.
printf '%s\n' 'Warning: gitleaks not found; skipping local secret scan. Run nix develop or brew install gitleaks.' >&2
exit 0
