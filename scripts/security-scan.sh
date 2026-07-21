#!/usr/bin/env bash

set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly tools_directory="$(mktemp --directory)"
readonly gitleaks_version=8.30.1
readonly gitleaks_archive="gitleaks_${gitleaks_version}_linux_x64.tar.gz"
readonly gitleaks_checksum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
readonly osv_scanner_version=2.3.8
readonly osv_scanner_checksum=bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc

cleanup() {
  rm -rf "$tools_directory"
}
trap cleanup EXIT

curl --fail --location --silent --show-error \
  "https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}/${gitleaks_archive}" \
  --output "$tools_directory/$gitleaks_archive"
echo "$gitleaks_checksum  $tools_directory/$gitleaks_archive" | sha256sum --check --status
tar --extract --gzip --file "$tools_directory/$gitleaks_archive" --directory "$tools_directory" gitleaks

curl --fail --location --silent --show-error \
  "https://github.com/google/osv-scanner/releases/download/v${osv_scanner_version}/osv-scanner_linux_amd64" \
  --output "$tools_directory/osv-scanner"
echo "$osv_scanner_checksum  $tools_directory/osv-scanner" | sha256sum --check --status
chmod +x "$tools_directory/osv-scanner"

"$tools_directory/gitleaks" git "$repository_root" \
  --log-opts='--all --full-history' \
  --redact \
  --no-banner \
  --no-color
"$tools_directory/osv-scanner" scan source --lockfile="$repository_root/bun.lock"
