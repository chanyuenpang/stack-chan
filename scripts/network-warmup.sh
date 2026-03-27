#!/bin/bash
# 网络预热脚本 - 在定时任务执行前确保网络连接正常
# 用途：在系统休眠或网络空闲后，提前唤醒网络连接

LOG_FILE="/home/yankeeting/.openclaw/logs/network-warmup.log"
MAX_RETRIES=5
RETRY_INTERVAL=3

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

check_network() {
    # 尝试 ping 国内公共 DNS
    if ping -c 1 -W 3 223.5.5.5 > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

warmup_network() {
    log "开始网络预热..."

    # 尝试连接几个常用的 API 端点，确保网络完全唤醒
    local endpoints=(
        "https://ark.cn-beijing.volces.com"
        "https://open.bigmodel.cn"
    )

    for endpoint in "${endpoints[@]}"; do
        curl -s -o /dev/null --connect-timeout 5 "$endpoint" 2>/dev/null
        if [ $? -eq 0 ]; then
            log "成功连接到 $endpoint"
        else
            log "连接 $endpoint 失败（可能是正常的，继续尝试其他端点）"
        fi
    done

    # 等待网络稳定
    sleep 2
}

# 主逻辑
log "=== 网络预热脚本启动 ==="

retry_count=0
while [ $retry_count -lt $MAX_RETRIES ]; do
    if check_network; then
        log "网络连接正常"
        warmup_network
        log "=== 网络预热完成 ==="
        exit 0
    fi

    retry_count=$((retry_count + 1))
    log "网络不可达，重试 $retry_count/$MAX_RETRIES..."
    sleep $RETRY_INTERVAL
done

log "警告：网络预热失败，但定时任务仍将执行"
log "=== 网络预热结束 ==="
exit 1
