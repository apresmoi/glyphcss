# syntax=docker/dockerfile:1.7
# B12 extends the immutable, dependency-complete B8 trainer by image ID. The
# only runtime addition is Node, copied from an independently digest-pinned
# official image so the mandatory B11 validator can run before model allocation.
FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0 AS pinned-node
FROM glyphcss-asset-corpus:native-v3-workers-r3 AS pinned-b11-validator
FROM glyphcss-ascii-trainer:b8 AS runtime
USER root
COPY --from=pinned-node /usr/local/bin/node /usr/local/bin/node
COPY --from=pinned-b11-validator /workspace/node_modules /workspace/repo/node_modules
COPY --from=pinned-b11-validator /workspace/research/ascii-image-generation/node_modules /workspace/repo/research/ascii-image-generation/node_modules
COPY --from=pinned-b11-validator /workspace/packages/core /workspace/repo/packages/core
COPY --from=pinned-b11-validator /workspace/packages/glyphcss /workspace/repo/packages/glyphcss
COPY --from=pinned-b11-validator /workspace/packages/compile /workspace/repo/packages/compile
RUN test "$(node --version)" = "v22.17.0" && \
    printf '%s\n' \
      'base-image-id=sha256:015926d93d16a87eed48877405da596b4d3a6a799693cad6fa5072151b36b476' \
      'b11-validator-dependencies-image-id=sha256:59bfcb988765459920e43879c9def0284e894e7fe98bb45c5eaf825a45a98abc' \
      'node-image=node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0' \
      'node-version=v22.17.0' \
      > /usr/local/share/glyphcss-node-provenance.txt
USER glyph:glyph
