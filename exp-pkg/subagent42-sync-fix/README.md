# Subagent #42 Sync Fix Experiment Package

## Purpose
修复 head scheduler 新动作开始前 `Servo::_angle_anim` 没有同步硬件 present，
导致 `base_yaw=90` 但 `anim_req=-1271` 的根因。

## Build Info
- Build dir: `firmware/build-subagent42/`
- Binary: `stack-chan.bin`
- Size: 3,789,824 bytes
- SHA256: 3d9181c6856c2661cd28c23c3cc4fa260d05e72a0255b8f261289b6f20541981
- PROJECT_VER: 2.0.12

## What's Changed
详见 subagent #42 验证报告:
- `servo.cpp`: 新增 `getAnimationAngle()` / `syncAnimationToCurrentAngle()`
- `motion.cpp`: Motion wrappers 调用上述方法
- `hal_mcp.cpp`: 在 `moveWithSpeed()` 前检测新动作并同步 present

## Current Server State
- OTA mock server port 8080: `upgrade` mode, version=2.0.12, force=0
- Currently serving: `build-2.0.12-diagnostic-only/stack-chan.bin` (3,789,312 bytes)
- Device last seen: `m5stack-stack-chan/2.0.12` at 13:14

## ⚠️ Version Blocker
Both the diagnostic-only build and this sync-fix build share version **2.0.12**.
With `force=0`, device will NOT trigger OTA (same version seen).

### Options to unblock:
1. **(Recommended) Bump version to 2.0.13**:
   - Edit `firmware/CMakeLists.txt`: change `set(PROJECT_VER "2.0.12")` → `set(PROJECT_VER "2.0.13")`
   - `cd firmware && idf.py reconfigure && idf.py build`
   - Restart server pointing to the new build

2. **Force push** (same version):
   - `cd tools/ota-mock-server && ./stop-ota-servers.sh`
   - Restart with `--force 1`
   - Works but non-standard for this project

## Deployment
Once unblocked, point server to this binary:
```
cd tools/ota-mock-server
./stop-ota-servers.sh
python3 ota-mock-server.py --mode upgrade --version 2.0.13 --lan-ip 192.168.0.12 --port 8080 --firmware /home/yankeeting/.../exp-pkg/subagent42-sync-fix/stack-chan.bin
```
Then on device side (via AP or WebUI), set ota_url to `http://192.168.0.12:8080/ota/` and trigger update.
