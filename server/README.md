# WrongBook VPS Sync Server

这个目录提供一个最小可用的单用户同步后端，使用 Node.js + Express + SQLite。

## 环境变量

复制 server/.env.example 为 server/.env，然后填写：

PORT=3001
SYNC_TOKEN=change-me
DATABASE_PATH=./data/wrongbook.sqlite

## 启动

1. 进入 server 目录
2. 执行 npm install
3. 执行 npm start

默认会监听 3001 端口，并自动创建 SQLite 数据库文件。

## 健康检查

curl https://你的域名/health

## 同步接口测试

curl -X POST https://你的域名/api/sync/questions \
  -H "Authorization: Bearer 你的token" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","records":[]}'

## NGINX 示例

server {
    listen 80;
    server_name 你的域名;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

## Windows 客户端 .env 示例

SYNC_API_URL=https://你的域名/api/sync/questions
SYNC_TOKEN=你的强随机token
SYNC_DEVICE_ID=windows-main

## Android 配置示例

SYNC_API_URL=https://你的域名/api/sync/questions
SYNC_TOKEN=你的强随机token
SYNC_DEVICE_ID=android-main

这些值分别填写到：

- Windows: wrong-question-assistant/.env
- Android: WrongBook/local.properties