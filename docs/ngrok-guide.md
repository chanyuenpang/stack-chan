# Ngrok 服务使用指南

## 概述

Ngrok 用于将本地服务暴露到公网，便于外部访问和测试。

## 当前配置

### 服务信息
- **本地服务地址**: `192.168.0.12:8123`
- **协议**: HTTP/HTTPS
- **配置文件位置**: `~/.config/ngrok/ngrok.yml`

### 认证令牌
配置文件中已设置 authtoken，位于 `~/.config/ngrok/ngrok.yml`

## 启动 Ngrok

### 方式一：命令行直接启动

```bash
# 启动 HTTP 隧道
/home/yankeeting/.local/bin/ngrok http 192.168.0.12:8123

# 或使用本地地址
ngrok http http://localhost:8123
```

### 方式二：后台运行

```bash
# 后台启动
nohup /home/yankeeting/.local/bin/ngrok http 192.168.0.12:8123 > /tmp/ngrok.log 2>&1 &
```

## 查看 Ngrok 状态

### 查看进程
```bash
ps aux | grep ngrok
```

### 查看隧道信息（Web 界面）
启动后访问: http://127.0.0.1:4040

### 通过 API 获取公网地址
```bash
curl -s http://127.0.0.1:4040/api/tunnels | jq '.tunnels[0].public_url'
```

## 关闭 Ngrok

### 查找进程
```bash
ps aux | grep ngrok
```

### 终止进程
```bash
kill <PID>
```

### 强制终止（如果需要）
```bash
kill -9 <PID>
```

## 常用 Ngrok 命令

```bash
# 查看版本
ngrok version

# 查看帮助
ngrok help

# 启动带认证的隧道
ngrok http -auth="user:password" 8080

# 启动 TCP 隧道
ngrok tcp 22
```

## 注意事项

1. 免费版 ngrok 的公网地址每次启动都会变化
2. 如需固定域名，需升级到付费版
3. 建议不要在配置文件中明文存储敏感信息
4. 使用完毕后记得关闭服务，避免资源占用和安全风险

## 相关链接

- Ngrok 官网: https://ngrok.com/
- Ngrok Dashboard: https://dashboard.ngrok.com/
- 文档: https://ngrok.com/docs/
