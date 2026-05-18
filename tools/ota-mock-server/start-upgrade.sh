#!/bin/bash
# ==============================================================
# start-upgrade.sh — 启动 OTA upgrade 模式 mock server
# 使用 port 8081（8080 通常被 probe server 占用）
# ==============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8081
LOG_FILE="/tmp/stackchan-ota-upgrade-${PORT}.log"
LAN_IP="${LAN_IP:-192.168.0.12}"
VERSION="${VERSION:-2.0.25}"

# --- 检查 port 是否被占用 ---
if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
    echo "❌ 端口 ${PORT} 已被占用。"
    echo "   占用进程："
    ss -tlnp | grep ":${PORT} "
    exit 1
fi

# --- 检查固件文件 ---
FIRMWARE="${SCRIPT_DIR}/../../firmware/build/stack-chan.bin"
if [ ! -f "$FIRMWARE" ]; then
    echo "❌ 固件文件不存在: ${FIRMWARE}"
    echo "   请先编译或准备固件。"
    exit 1
fi

echo "=== 启动 OTA upgrade mock server ==="
nohup python3 "${SCRIPT_DIR}/ota-mock-server.py" \
    --mode upgrade \
    --version "${VERSION}" \
    --force 1 \
    --port ${PORT} \
    > "${LOG_FILE}" 2>&1 &
PID=$!

# 等待启动
sleep 1

# 验证进程是否存活
if kill -0 "$PID" 2>/dev/null; then
    echo "✅ 启动成功"
    echo "  PID:      ${PID}"
    echo "  Port:     ${PORT}"
    echo "  Log:      ${LOG_FILE}"
    echo "  OTA URL:  http://${LAN_IP}:${PORT}/ota/"
    echo ""
    echo "  tail -f ${LOG_FILE}"
    echo ""
    echo "=== 验证 manifest ==="
    curl -s "http://${LAN_IP}:${PORT}/ota/" | python3 -m json.tool
else
    echo "❌ 启动失败，查看日志：${LOG_FILE}"
    tail -5 "${LOG_FILE}"
    exit 1
fi
