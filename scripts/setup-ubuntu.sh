#!/usr/bin/env bash

set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" "$@"
  fi

  echo "Script này cần quyền root hoặc sudo." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
fi

if apt-cache show chromium-browser >/dev/null 2>&1; then
  apt-get install -y chromium-browser
elif apt-cache show chromium >/dev/null 2>&1; then
  apt-get install -y chromium
else
  echo "Không tìm thấy gói chromium-browser hoặc chromium trong repo Ubuntu hiện tại." >&2
  echo "Hãy cài browser thủ công và set CHROME_PATH trỏ tới binary." >&2
fi

cd "$(dirname "$0")/.."
npm install

echo "Hoàn tất setup Ubuntu."
echo "Nếu cần, set CHROME_PATH trước khi chạy; ví dụ /usr/bin/chromium hoặc /snap/bin/chromium."