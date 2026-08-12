#!/usr/bin/env bash
set -euo pipefail

: "${GLYPHCSS_WEBSITE_BROWSER_RUN_DIR:?GLYPHCSS_WEBSITE_BROWSER_RUN_DIR is required}"
run_dir="$GLYPHCSS_WEBSITE_BROWSER_RUN_DIR"
if [[ -e "$run_dir" ]]; then
  echo "Website browser run directory already exists: $run_dir" >&2
  exit 1
fi
mkdir -p "$run_dir"

{
  node --version
  pnpm --version
  pnpm exec playwright --version
  uname -a
  cat /etc/os-release
} >"$run_dir/environment.txt"
sha256sum \
  website/src/components/GenerativeWorkbench/GenerativeWorkbench.tsx \
  website/src/components/GenerativeWorkbench/generative-workbench.css \
  website/src/components/InstrumentWorkbench/InstrumentWorkbench.tsx \
  website/src/components/InstrumentWorkbench/instrument-workbench.css \
  website/src/components/SynthWorkbench/SynthWorkbench.tsx \
  website/src/pages/generative.astro \
  research/ascii-image-generation/config/glyph-object-dictionary.json \
  research/ascii-image-generation/config/control-normalization.json \
  research/ascii-image-generation/fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf \
  research/ascii-image-generation/browser/website-generative.spec.ts \
  research/ascii-image-generation/browser/gallery-regression.spec.ts \
  research/ascii-image-generation/tests/website-generative.test.ts \
  >"$run_dir/source-sha256.txt"

pnpm --filter @glyphcss/website exec astro dev --host 127.0.0.1 --port 43219 --strictPort >"$run_dir/server.log" 2>&1 &
server_pid=$!
cleanup() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT

node --input-type=module <<'NODE'
import net from "node:net";
const deadline = Date.now() + 30_000;
await new Promise((resolve, reject) => {
  const poll = () => {
    const probe = net.connect(43219, "127.0.0.1");
    probe.once("connect", () => { probe.destroy(); resolve(); });
    probe.once("error", () => Date.now() >= deadline ? reject(new Error("website server did not start")) : setTimeout(poll, 100));
  };
  poll();
});
NODE

export GLYPHCSS_GALLERY_URL=http://127.0.0.1:43219
export PLAYWRIGHT_JSON_OUTPUT_NAME="$run_dir/results.json"
set +e
pnpm --filter @glyphcss/ascii-image-generation exec playwright test \
  --grep 'website-generative|gallery-regression' \
  --workers=1 \
  --output "$run_dir/test-results" \
  --reporter=line,json \
  >"$run_dir/test.log" 2>&1
test_exit=$?
set -e
printf '%s\n' "$test_exit" >"$run_dir/exit-code.txt"
cat "$run_dir/test.log"
exit "$test_exit"
