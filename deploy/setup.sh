#!/usr/bin/env bash
# Provision trux from an existing checkout. Delegates to the shared core so there
# is one implementation (see deploy/provision.sh). For a from-scratch install on
# a new box, use the one-liner in README.md instead.
set -euo pipefail
exec bash "$(cd "$(dirname "$0")" && pwd)/provision.sh" "$@"
