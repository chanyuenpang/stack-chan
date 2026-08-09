#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE="$ROOT_DIR/ops/templates/ota-device-rollback-acceptance.template.md"
OUT_DIR="$ROOT_DIR/docs/acceptance"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "[ERROR] 模板不存在: $TEMPLATE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

DATE="$(date +%Y%m%d)"
TIME="$(date +%H%M%S)"
NAME="${1:-ota-device-rollback}"
DEVICE_ID="${2:-<device_id>}"
CUR_VER="${3:-<current_version>}"
TARGET_VER="${4:-<target_version>}"

FILE="$OUT_DIR/${DATE}-${TIME}-${NAME}.md"
cp "$TEMPLATE" "$FILE"

# 轻量占位替换（仅替换首个默认值，避免破坏其他文本）
sed -i "0,/设备 ID: ``/s//设备 ID: \`$DEVICE_ID\`/" "$FILE"
sed -i "0,/当前版本（Current Version）: ``/s//当前版本（Current Version）: \`$CUR_VER\`/" "$FILE"
sed -i "0,/目标版本（Target Version）: ``/s//目标版本（Target Version）: \`$TARGET_VER\`/" "$FILE"

echo "[OK] 已生成验收记录骨架: $FILE"
echo "[NEXT] 请补全 Before/Action/After/Conclusion 四段信息，并填写证据与 PASS/FAIL。"
