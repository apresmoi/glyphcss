#!/bin/sh
set -eu
node "$(dirname "$0")/validate-pilot.mjs" "$@"
