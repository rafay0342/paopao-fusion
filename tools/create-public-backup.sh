#!/usr/bin/env bash
set -Eeuo pipefail

# Build the immutable, public Phaser-only source/release archive. This script is
# intentionally no-overwrite: move an older published archive out of the way
# explicitly before running it again.

readonly ARCHIVE_DIRECTORY="/mnt/c/Users/SPHF/Documents"
readonly ARCHIVE_BASENAME="paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz"
readonly ARCHIVE_PATH="${ARCHIVE_DIRECTORY}/${ARCHIVE_BASENAME}"
readonly CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if (( $# != 0 )); then
  fail "this command accepts no arguments and never overwrites an existing archive"
fi

for command_name in awk find grep gzip mktemp mv sha256sum sort stat tar uniq; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "required command is unavailable: ${command_name}"
done

tar --version 2>/dev/null | grep -q 'GNU tar' || fail 'GNU tar is required'

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PROJECT_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd -P)"
readonly PROJECT_NAME="$(basename -- "${PROJECT_ROOT}")"
readonly PROJECT_PARENT="$(dirname -- "${PROJECT_ROOT}")"

[[ "${PROJECT_NAME}" == 'paopao-phaser' ]] || fail "unexpected project directory: ${PROJECT_ROOT}"
[[ -d "${ARCHIVE_DIRECTORY}" && -w "${ARCHIVE_DIRECTORY}" ]] || fail "archive directory is not writable: ${ARCHIVE_DIRECTORY}"
[[ ! -e "${ARCHIVE_PATH}" ]] || fail "archive already exists: ${ARCHIVE_PATH}"
[[ ! -e "${CHECKSUM_PATH}" ]] || fail "checksum already exists: ${CHECKSUM_PATH}"

readonly -a RELEASE_IDS=(
  'r1-level100-foundation-contextfix-20260722'
  'r2-level100-gameplay-contextfix-20260722'
  'r3-level100-cinematic-contextfix-20260722'
  'r4-level100-liveops-contextfix-20260722'
  'r5-level100-production-contextfix-20260722'
)

readonly -a SPECIAL_PLAYWRIGHT_PATHS=(
  'output/playwright/hand-guide-map.png'
  'output/playwright/hand-guide-setup.png'
  'output/playwright/paopao-v10-gameplay-desktop.png'
  'output/playwright/r5-contextfix-before-loss-2026-07-22.png'
  'output/playwright/r5-contextfix-after-restore-2026-07-22.png'
)

declare -a CRITICAL_PATHS=(
  'package.json'
  'docs/production/BACKUP_INFO.md'
  'docs/production/implementation-status.md'
  'docs/production/security-gates-2026-07-22.md'
  'docs/production/phaser-release-gates.md'
  'docs/production/release-and-rollback-runbook.md'
  'docs/production/upgrade-ledger.json'
  'docs/production/context-recovery-smoke-2026-07-22.json'
  'docs/production/context-recovery-smoke-2026-07-22.md'
  'docs/production/initial-payload-contextfix-2026-07-22.json'
  'docs/production/initial-payload-contextfix-2026-07-22.md'
  'docs/production/private-backup-drill-contextfix-2026-07-22.json'
  'docs/production/private-backup-drill-contextfix-2026-07-22.md'
  'docs/production/performance-soak-desktop-contextfix-2026-07-22.json'
  'docs/production/performance-soak-desktop-contextfix-2026-07-22.md'
  'docs/production/performance-soak-mobile-emulated-contextfix-2026-07-22.json'
  'docs/production/performance-soak-mobile-emulated-contextfix-2026-07-22.md'
  'docs/production/goldens/r5-contextfix-desktop-soak-start-2026-07-22.png'
  'docs/production/goldens/r5-contextfix-desktop-soak-mid-2026-07-22.png'
  'docs/production/goldens/r5-contextfix-desktop-soak-final-2026-07-22.png'
  'docs/production/goldens/r5-contextfix-mobile-emulated-soak-start-2026-07-22.png'
  'docs/production/goldens/r5-contextfix-mobile-emulated-soak-mid-2026-07-22.png'
  'docs/production/goldens/r5-contextfix-mobile-emulated-soak-final-2026-07-22.png'
  'outputs/handtracking-tutorial/paopao-handtracking-double-tap-guide-v3.mp4'
  'outputs/handtracking-tutorial/paopao-handtracking-double-tap-guide-v3-poster.jpg'
  'outputs/handtracking-tutorial/paopao-handtracking-double-tap-guide-v3-contact-sheet.jpg'
  'releases-level100-final/state.json'
  "${SPECIAL_PLAYWRIGHT_PATHS[@]}"
)

for required_path in "${CRITICAL_PATHS[@]}"; do
  [[ -f "${PROJECT_ROOT}/${required_path}" ]] || fail "required input is missing: ${required_path}"
done

readonly GUIDE_RELATIVE_PATH='outputs/handtracking-tutorial/paopao-handtracking-double-tap-guide-v3.mp4'
readonly GUIDE_PATH="${PROJECT_ROOT}/${GUIDE_RELATIVE_PATH}"
readonly BACKUP_INFO_PATH="${PROJECT_ROOT}/docs/production/BACKUP_INFO.md"
readonly DOCUMENTED_GUIDE_SHA256="$(awk '/^Its SHA-256 is$/ { getline; gsub(/[^0-9a-f]/, ""); print; exit }' "${BACKUP_INFO_PATH}")"
readonly ACTUAL_GUIDE_SHA256="$(sha256sum -- "${GUIDE_PATH}" | awk '{print $1}')"
[[ "${DOCUMENTED_GUIDE_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail 'BACKUP_INFO.md has no valid hand-guide SHA-256'
[[ "${DOCUMENTED_GUIDE_SHA256}" == "${ACTUAL_GUIDE_SHA256}" ]] ||
  fail 'BACKUP_INFO.md hand-guide SHA-256 is stale; update it after rendering the final guide'

for guide_input in \
  'tools/render-hand-guide-v3.sh' \
  'output/playwright/paopao-v10-gameplay-desktop.png' \
  'outputs/handtracking-tutorial/hand-gestures-transparent.png' \
  'public/assets/sprites/v11/phoenix-green.png' \
  'public/assets/audio/prism-pulse-game.ogg'; do
  [[ "${GUIDE_PATH}" -nt "${PROJECT_ROOT}/${guide_input}" ]] ||
    fail "hand-guide output is older than its input: ${guide_input}"
done

for release_id in "${RELEASE_IDS[@]}"; do
  release_root="${PROJECT_ROOT}/releases-level100-final/${release_id}"
  for release_path in \
    'release-manifest.json' \
    'client/index.html' \
    'client/classic/index.html' \
    'client/release-profile.json' \
    'client/sw.js'; do
    [[ -f "${release_root}/${release_path}" ]] || fail "required release artifact is missing: ${release_id}/${release_path}"
    CRITICAL_PATHS+=("releases-level100-final/${release_id}/${release_path}")
  done

  mapfile -d '' -t app_bundles < <(find "${release_root}/client/assets" -maxdepth 1 -type f -name 'index-*.js' -print0 | sort -z)
  (( ${#app_bundles[@]} == 1 )) || fail "expected exactly one app bundle in release ${release_id}"
  CRITICAL_PATHS+=("${app_bundles[0]#"${PROJECT_ROOT}/"}")

  mapfile -d '' -t hand_bundles < <(find "${release_root}/client/assets" -maxdepth 1 -type f -name 'handtracking.worker-*.js' -print0 | sort -z)
  (( ${#hand_bundles[@]} == 1 )) || fail "expected exactly one hand-tracking worker in release ${release_id}"
  CRITICAL_PATHS+=("${hand_bundles[0]#"${PROJECT_ROOT}/"}")
done

readonly LOCK_DIRECTORY="${ARCHIVE_DIRECTORY}/.paopao-public-backup.lock"
mkdir -- "${LOCK_DIRECTORY}" 2>/dev/null || fail "another archive build is active, or a stale lock exists: ${LOCK_DIRECTORY}"

TEMP_DIRECTORY=''
cleanup() {
  local expected_prefix="${ARCHIVE_DIRECTORY}/.paopao-public-backup."
  if [[ -n "${TEMP_DIRECTORY}" && "${TEMP_DIRECTORY}" == "${expected_prefix}"* && -d "${TEMP_DIRECTORY}" ]]; then
    rm -rf -- "${TEMP_DIRECTORY}"
  fi
  rmdir -- "${LOCK_DIRECTORY}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

TEMP_DIRECTORY="$(mktemp -d -- "${ARCHIVE_DIRECTORY}/.paopao-public-backup.XXXXXXXX")"
readonly TEMP_TAR="${TEMP_DIRECTORY}/archive.tar"
readonly TEMP_GZIP="${TEMP_DIRECTORY}/${ARCHIVE_BASENAME}"
readonly TEMP_CHECKSUM="${TEMP_DIRECTORY}/${ARCHIVE_BASENAME}.sha256"
readonly MEMBER_LIST="${TEMP_DIRECTORY}/members.txt"
readonly VERIFY_DIRECTORY="${TEMP_DIRECTORY}/verify"
mkdir -- "${VERIFY_DIRECTORY}"

readonly -a TAR_METADATA_OPTIONS=(
  '--format=gnu'
  '--sort=name'
  '--mtime=@0'
  '--owner=0'
  '--group=0'
  '--numeric-owner'
  '--mode=u+rwX,go+rX,go-w'
  '--no-acls'
  '--no-selinux'
  '--no-xattrs'
)

readonly -a TAR_EXCLUDES=(
  "--exclude=${PROJECT_NAME}/node_modules"
  '--exclude=*/node_modules'
  "--exclude=${PROJECT_NAME}/releases"
  "--exclude=${PROJECT_NAME}/data"
  "--exclude=${PROJECT_NAME}/data-*"
  "--exclude=${PROJECT_NAME}/backups"
  '--exclude=*/backups'
  "--exclude=${PROJECT_NAME}/unity"
  '--exclude=*/unity'
  '--exclude=*/.git'
  '--exclude=*/.playwright-cli'
  '--exclude=*/logs'
  '--exclude=*/__pycache__'
  '--exclude=*/env'
  '--exclude=*/venv'
  '--exclude=*/.venv'
  "--exclude=${PROJECT_NAME}/public/3d"
  "--exclude=${PROJECT_NAME}/output/playwright"
  "--exclude=${PROJECT_NAME}/output/release-builds"
  "--exclude=${PROJECT_NAME}/output/full-test-report*.json"
  '--exclude=*.log'
  '--exclude=*.err'
  '--exclude=*.out'
  '--exclude=*.pyc'
  '--exclude=*.sqlite'
  '--exclude=*.sqlite-*'
  '--exclude=*.db'
  '--exclude=*.db-*'
  '--exclude=*.pbackup'
  '--exclude=*.pem'
  '--exclude=*.p12'
  '--exclude=*.pfx'
  '--exclude=*.jks'
  '--exclude=*.keystore'
  '--exclude=*.key'
  '--exclude=.env'
  '--exclude=.env.*'
  '--exclude=*.env'
  '--exclude=.npmrc'
  '--exclude=.netrc'
  '--exclude=*secret*'
  '--exclude=*Secret*'
  '--exclude=*SECRET*'
  '--exclude=NUL'
  '--exclude=nul'
  '--exclude=*.tmp'
  '--exclude=*.temp'
  '--exclude=*.part'
  '--exclude=*.swp'
  '--exclude=*~'
  '--exclude=range-*'
  '--exclude=.range-*'
  '--exclude=range.bin'
  '--exclude=*.range'
  '--exclude=.DS_Store'
  '--exclude=Thumbs.db'
  '--exclude=thumbs.db'
  '--exclude=desktop.ini'
  '--exclude=Desktop.ini'
  '--exclude=__MACOSX'
  '--exclude=._*'
)

printf 'Creating deterministic uncompressed archive...\n'
tar --create --file="${TEMP_TAR}" \
  --directory="${PROJECT_PARENT}" \
  "${TAR_METADATA_OPTIONS[@]}" \
  "${TAR_EXCLUDES[@]}" \
  -- "${PROJECT_NAME}"

# output/playwright is excluded wholesale above. Append only the immutable guide
# source captures and fixed-R5 context-recovery captures named above.
for special_path in "${SPECIAL_PLAYWRIGHT_PATHS[@]}"; do
  tar --append --file="${TEMP_TAR}" \
    --directory="${PROJECT_PARENT}" \
    --format=gnu \
    --mtime='@0' \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    --mode='u+rwX,go+rX,go-w' \
    --no-acls \
    --no-selinux \
    --no-xattrs \
    -- "${PROJECT_NAME}/${special_path}"
done

compression_threads="${PAOPAO_BACKUP_THREADS:-4}"
[[ "${compression_threads}" =~ ^[1-9][0-9]*$ ]] || fail 'PAOPAO_BACKUP_THREADS must be a positive integer'
(( compression_threads <= 64 )) || fail 'PAOPAO_BACKUP_THREADS must not exceed 64'

printf 'Compressing archive...\n'
if command -v pigz >/dev/null 2>&1; then
  pigz -n -6 -p "${compression_threads}" < "${TEMP_TAR}" > "${TEMP_GZIP}"
else
  gzip -n -6 -c "${TEMP_TAR}" > "${TEMP_GZIP}"
fi

gzip -t -- "${TEMP_GZIP}"
tar -tzf "${TEMP_GZIP}" > "${MEMBER_LIST}"

# Validate path safety, sensitive-data exclusions, and the strict Playwright
# allowlist against the archive itself rather than trusting only tar excludes.
awk -v root="${PROJECT_NAME}" '
  function reject(reason) {
    printf "forbidden archive member (%s): %s\n", reason, original > "/dev/stderr"
    invalid = 1
  }
  {
    original = $0
    lower = tolower(original)
    if (substr(original, 1, 1) == "/" || original ~ /(^|\/)\.\.($|\/)/) reject("unsafe path")

    playwright_prefix = root "/output/playwright/"
    if (index(original, playwright_prefix) == 1 &&
        original != playwright_prefix "hand-guide-map.png" &&
        original != playwright_prefix "hand-guide-setup.png" &&
        original != playwright_prefix "paopao-v10-gameplay-desktop.png" &&
        original != playwright_prefix "r5-contextfix-before-loss-2026-07-22.png" &&
        original != playwright_prefix "r5-contextfix-after-restore-2026-07-22.png") reject("playwright allowlist")

    if (original ~ ("^" root "/releases(/|$)")) reject("legacy releases")
    if (original ~ ("^" root "/data(/|$)") || original ~ ("^" root "/data-[^/]*(/|$)")) reject("runtime data")
    if (original ~ ("^" root "/backups(/|$)")) reject("private backups")
    if (original ~ ("^" root "/unity(/|$)")) reject("Unity")
    if (original ~ ("^" root "/public/3d(/|$)")) reject("retired 3d route")
    if (original ~ ("^" root "/output/release-builds(/|$)")) reject("duplicate release builds")
    if (original ~ ("^" root "/output/full-test-report[^/]*[.]json$")) reject("temporary test report")

    if (lower ~ /(^|\/)node_modules(\/|$)/) reject("node_modules")
    if (lower ~ /(^|\/)[.]git(\/|$)/) reject("git metadata")
    if (lower ~ /(^|\/)[.]playwright-cli(\/|$)/) reject("playwright state")
    if (lower ~ /(^|\/)logs(\/|$)/) reject("logs directory")
    if (lower ~ /(^|\/)__pycache__(\/|$)/ || lower ~ /[.]pyc$/) reject("python cache")
    if (lower ~ /(^|\/)[.]?venv(\/|$)/ || lower ~ /(^|\/)env(\/|$)/) reject("environment directory")
    if (lower ~ /[.](log|err|out)$/) reject("log output")
    if (lower ~ /[.](sqlite|db|pbackup|pem|p12|pfx|jks|keystore|key)([-.]|$)/) reject("private or credential file")
    if (lower ~ /(^|\/)[.]env([.]|$)/ || lower ~ /[.]env$/ || lower ~ /(^|\/)[.](npmrc|netrc)$/) reject("environment credential file")
    if (lower ~ /(^|\/)[^/]*secret[^/]*(\/|$)/) reject("secret-named member")
    if (lower ~ /(^|\/)(nul|thumbs[.]db|desktop[.]ini|[.]ds_store)(\/|$)/) reject("OS junk")
    if (lower ~ /(^|\/)__macosx(\/|$)/ || lower ~ /(^|\/)[.]_[^/]*(\/|$)/) reject("Apple metadata")
    if (lower ~ /[.](tmp|temp|part|swp|range)$/ || lower ~ /~$/ || lower ~ /(^|\/)[.]?range-[^/]*$/ || lower ~ /(^|\/)range[.]bin$/) reject("temporary range file")
  }
  END { exit invalid ? 1 : 0 }
' "${MEMBER_LIST}"

duplicate_member="$(sort "${MEMBER_LIST}" | uniq -d | head -n 1 || true)"
[[ -z "${duplicate_member}" ]] || fail "duplicate archive member: ${duplicate_member}"

for required_path in "${CRITICAL_PATHS[@]}"; do
  archive_member="${PROJECT_NAME}/${required_path}"
  grep -Fqx -- "${archive_member}" "${MEMBER_LIST}" || fail "required archive member is missing: ${archive_member}"
done

playwright_member_count="$(grep -Fxc \
  -e "${PROJECT_NAME}/${SPECIAL_PLAYWRIGHT_PATHS[0]}" \
  -e "${PROJECT_NAME}/${SPECIAL_PLAYWRIGHT_PATHS[1]}" \
  -e "${PROJECT_NAME}/${SPECIAL_PLAYWRIGHT_PATHS[2]}" \
  -e "${PROJECT_NAME}/${SPECIAL_PLAYWRIGHT_PATHS[3]}" \
  -e "${PROJECT_NAME}/${SPECIAL_PLAYWRIGHT_PATHS[4]}" \
  "${MEMBER_LIST}" || true)"
[[ "${playwright_member_count}" == "${#SPECIAL_PLAYWRIGHT_PATHS[@]}" ]] ||
  fail "expected exactly ${#SPECIAL_PLAYWRIGHT_PATHS[@]} allowlisted Playwright members, found ${playwright_member_count}"

manifest_count="$(grep -Ec "^${PROJECT_NAME}/releases-level100-final/r[1-5]-level100-[^/]+/release-manifest[.]json$" "${MEMBER_LIST}" || true)"
[[ "${manifest_count}" == '5' ]] || fail "expected five final release manifests, found ${manifest_count}"

# Extract only a bounded critical set and compare it byte-for-byte with source.
critical_archive_paths=()
for required_path in "${CRITICAL_PATHS[@]}"; do
  critical_archive_paths+=("${PROJECT_NAME}/${required_path}")
done
tar -xzf "${TEMP_GZIP}" --directory="${VERIFY_DIRECTORY}" -- "${critical_archive_paths[@]}"

printf 'Verified critical source hashes:\n'
for required_path in "${CRITICAL_PATHS[@]}"; do
  source_hash="$(sha256sum -- "${PROJECT_ROOT}/${required_path}" | awk '{print $1}')"
  extracted_hash="$(sha256sum -- "${VERIFY_DIRECTORY}/${PROJECT_NAME}/${required_path}" | awk '{print $1}')"
  [[ "${source_hash}" == "${extracted_hash}" ]] || fail "critical extraction hash mismatch: ${required_path}"
  printf '%s  %s/%s\n' "${source_hash}" "${PROJECT_NAME}" "${required_path}"
done

archive_sha256="$(sha256sum -- "${TEMP_GZIP}" | awk '{print $1}')"
printf '%s  %s\n' "${archive_sha256}" "${ARCHIVE_BASENAME}" > "${TEMP_CHECKSUM}"

# Recheck immediately before publication. mv --no-clobber plus the source-file
# check closes the accidental overwrite case even if another process races us.
[[ ! -e "${ARCHIVE_PATH}" && ! -e "${CHECKSUM_PATH}" ]] || fail 'archive destination appeared while the build was running'
mv --no-clobber -- "${TEMP_GZIP}" "${ARCHIVE_PATH}"
[[ ! -e "${TEMP_GZIP}" ]] || fail "refused to overwrite archive destination: ${ARCHIVE_PATH}"
mv --no-clobber -- "${TEMP_CHECKSUM}" "${CHECKSUM_PATH}"
[[ ! -e "${TEMP_CHECKSUM}" ]] || fail "refused to overwrite checksum destination: ${CHECKSUM_PATH}"

(cd -- "${ARCHIVE_DIRECTORY}" && sha256sum -c -- "$(basename -- "${CHECKSUM_PATH}")")

member_count="$(awk 'END { print NR }' "${MEMBER_LIST}")"
archive_bytes="$(stat -c '%s' -- "${ARCHIVE_PATH}")"
printf '\nArchive: %s\n' "${ARCHIVE_PATH}"
printf 'Checksum: %s\n' "${CHECKSUM_PATH}"
printf 'SHA-256: %s\n' "${archive_sha256}"
printf 'Bytes: %s\n' "${archive_bytes}"
printf 'Members: %s\n' "${member_count}"
