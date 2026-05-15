#!/usr/bin/env bash
# ------------------------------------------------------------------
# 一键设置 / 清空 StackChan 配网门户的 ota_url
# 使用前提：本机已连接设备的配网 AP (Xiaozhi-XX)
# ------------------------------------------------------------------
set -euo pipefail

PORTAL="http://192.168.4.1/advanced/submit"

action="${1:-help}"

case "$action" in
  set)
    if [ $# -lt 2 ]; then
      echo "Usage: $0 set <OTA_URL>"
      echo "   eg: $0 set http://192.168.1.100:8080/ota/"
      exit 1
    fi
    url="$2"
    echo "[*] Setting ota_url = $url"
    curl -s -X POST "$PORTAL" \
      -H "Content-Type: application/json" \
      -d "{\"ota_url\":\"$url\"}" | python3 -m json.tool
    echo "[✓] Done."
    ;;
  clear)
    echo "[*] Clearing ota_url"
    curl -s -X POST "$PORTAL" \
      -H "Content-Type: application/json" \
      -d '{"ota_url":""}' | python3 -m json.tool
    echo "[✓] Done."
    ;;
  official)
    echo "[*] Restoring official ota_url"
    curl -s -X POST "$PORTAL" \
      -H "Content-Type: application/json" \
      -d '{"ota_url":"https://api.tenclass.net/xiaozhi/ota/"}' | python3 -m json.tool
    echo "[✓] Done."
    ;;
  *)
    echo "StackChan ota_url helper — connect to device AP first!"
    echo ""
    echo "Usage:"
    echo "  $0 set <URL>     Set custom ota_url"
    echo "  $0 clear         Clear ota_url (empty string)"
    echo "  $0 official      Restore official ota_url"
    echo ""
    echo "Examples:"
    echo "  $0 set http://192.168.1.100:8080/ota/"
    exit 1
    ;;
esac
