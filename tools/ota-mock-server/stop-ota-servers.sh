#!/bin/bash
# ==============================================================
# stop-ota-servers.sh — 停止所有 ota-mock-server 进程
# ==============================================================
set -e

PIDS=$(pgrep -f "ota-mock-server.py" 2>/dev/null || true)

if [ -z "$PIDS" ]; then
    echo "没有运行中的 ota-mock-server 进程。"
    exit 0
fi

echo "发现以下 ota-mock-server 进程："
for PID in $PIDS; do
    PORT=$(ps -p "$PID" -o args --no-headers 2>/dev/null | grep -oP '--port \K\d+' || echo "?")
    START=$(ps -p "$PID" -o lstart --no-headers 2>/dev/null || echo "?")
    echo "  PID ${PID} | port ${PORT} | started ${START}"
done

echo ""
echo "正在停止..."
for PID in $PIDS; do
    kill "$PID" 2>/dev/null && echo "  ✅ PID ${PID} 已停止" || echo "  ❌ PID ${PID} 停止失败"
done

# 确认
sleep 0.5
REMAINING=$(pgrep -f "ota-mock-server.py" 2>/dev/null || true)
if [ -z "$REMAINING" ]; then
    echo ""
    echo "✅ 所有 ota-mock-server 进程已停止。"
else
    echo ""
    echo "⚠️  仍有进程残留: ${REMAINING}，尝试 SIGKILL..."
    kill -9 $REMAINING 2>/dev/null || true
fi
