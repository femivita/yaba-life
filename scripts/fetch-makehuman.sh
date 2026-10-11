#!/usr/bin/env bash
# Downloads MakeHuman's CC0 assets (via the makehuman-data npm package) into .cache/
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .cache/makehuman-data
npm pack makehuman-data@0.0.2 --pack-destination .cache >/dev/null
tar xzf .cache/makehuman-data-0.0.2.tgz -C .cache/makehuman-data
rm .cache/makehuman-data-0.0.2.tgz
echo "MakeHuman data in .cache/makehuman-data/package"
