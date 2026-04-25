# WrongBook VPS Sync Server

这个目录提供一个最小可用的单用户同步后端，使用 Node.js + Express + SQLite。

推荐 Node 18 或 Node 20，即可正常运行；不要求 Node 22+。

## 环境变量

复制 server/.env.example 为 server/.env，然后填写：

PORT=3001
SYNC_TOKEN=change-me
DATABASE_PATH=./data/wrongbook.sqlite

## 启动

1. 进入 server 目录
2. 确认 Node 版本为 18 或 20
2. 执行 npm install
3. 执行 npm start

默认会监听 3001 端口，并自动创建 SQLite 数据库文件。

服务端当前会把同步上来的 inline base64 图片保存在 SQLite 中，个人使用可以接受；如果后续图片长期增多，数据库体积会持续增长，可再迁移到对象存储。

## 手动验证

1. Android 老数据库升级
  - 在旧版 app 已有本地数据的设备上安装新版。
  - 应用不应崩溃。
  - 旧数据中的 questionText、userAnswer、correctAnswer 应默认补为空字符串。

2. 图片同步
  - Windows 新建一题并带主图，同步到服务端。
  - Android 执行同步后，应能看到图片。
  - Android 本地 Room 中保存的应是本地 file uri，而不是长 dataUrl。
  - Android 再次同步时，仍应能把本地 file 图片转成 inline 上传给服务端。

3. 冲突合并
  - Windows 修改标题。
  - Android 修改 notes。
  - 两端依次同步。
  - 最终标题和 notes 都应同时保留，不应互相覆盖。

4. 复习合并
  - Android 完成一次复习并同步。
  - Windows 修改题目标题并同步。
  - 最终 reviewCount 不应倒退，lastReviewedAt 应保持较新值。

5. 服务端兼容
  - 在 Node 18 或 Node 20 环境下执行 npm install 和 npm start。
  - GET /health 应返回 ok=true。
  - POST /api/sync/questions 应返回 records 数组。

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