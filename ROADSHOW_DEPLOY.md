# 康续家长期公网路演部署说明

目标：评委手机不需要连接同一个 Wi-Fi/热点，直接扫码 HTTPS 地址即可访问，并且这个地址以后继续可用。

## 推荐方案

把本目录部署到支持 Node.js Web Service 的平台，例如 Render、Railway、Fly.io、阿里云/腾讯云轻量服务器等。部署后会得到一个固定 HTTPS 域名，例如：

```text
https://kangxujia-roadshow.onrender.com/s
```

网站会自动识别公网域名，二维码也会自动使用当前公网地址，不再依赖 `192.168.*.*` 或临时 Cloudflare 链接。

## Render 部署步骤

1. 把以下文件放到同一个代码仓库或压缩包目录：
   - `site.html`
   - `roadshow-server.cjs`
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

## 注意事项

- Cloudflare quick tunnel 和 ngrok 免费临时链接适合调试，不适合正式答辩，因为地址可能每天变化。
- 手机端真实摄像头训练建议使用 HTTPS 公网地址，避免浏览器限制摄像头权限。
- 当前数据同步使用演示级 JSON 文件。正式上线建议换成数据库和账号鉴权。
