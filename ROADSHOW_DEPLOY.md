# 康续家数据库版公网部署说明

目标：评委手机不需要连接同一个 Wi-Fi/热点，直接扫码 HTTPS 地址即可访问，并且这个地址以后继续可用。

## 推荐方案

把本目录部署到支持 Node.js Web Service 的平台，例如 Render、Railway、Fly.io、阿里云/腾讯云轻量服务器等。部署后会得到一个固定 HTTPS 域名，例如：

```text
https://kangxujia-roadshow.onrender.com/s
```

网站会自动识别公网域名，二维码也会自动使用当前公网地址，不再依赖 `192.168.*.*` 或临时 Cloudflare 链接。

## Render 部署步骤

1. 把整个项目目录放入同一个代码仓库，至少包含：
   - `site.html`
   - `roadshow-server.cjs`
   - `database.cjs`
   - `data/seed-data.json`
   - `package.json`
   - `render.yaml`
2. 在 Render 创建 Web Service，连接该仓库。
3. Build Command 使用：

```bash
npm install
```

4. Start Command 使用：

```bash
npm start
```

5. 部署完成后访问：

```text
https://你的服务域名/s
```

6. 路演时让评委扫描这个 HTTPS 地址即可。

## 数据库说明

- 项目使用 Node.js 24 内置的 `node:sqlite`，不依赖第三方原生数据库驱动。
- 首次启动会根据 `data/seed-data.json` 自动创建 SQLite 数据库和全部数据表。
- `render.yaml` 已配置 `/var/data` 持久磁盘，数据库文件为 `/var/data/kangxujia.db`。
- 登录密码会以 `scrypt` 加盐哈希保存，不再由前端硬编码校验。
- `/api/database/summary` 可查看各数据表记录数和数据源。

## 注意事项

- Cloudflare quick tunnel 和 ngrok 免费临时链接适合调试，不适合正式答辩，因为地址可能每天变化。
- 手机端真实摄像头训练建议使用 HTTPS 公网地址，避免浏览器限制摄像头权限。
- Excel 数据包明确标注为模拟病例流程数据，不应作为真实临床疗效数据使用。
- 正式接入真实患者数据前，仍需完成知情同意、伦理审批、数据脱敏、访问审计和更严格的服务端会话鉴权。
