#!/bin/bash
# RandevunHazır'ı canlıya yayınlar (Mac / Linux). Kullanım: ./deploy/yayinla.sh  [--testsiz] [--kuru] [--hepsi]
cd "$(dirname "$0")/.." || exit 1
command -v node >/dev/null || { echo "Node.js kurulu değil: https://nodejs.org"; exit 1; }
node deploy/yayinla.mjs "$@"
