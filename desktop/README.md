# EnglishLearner — 英语学习桌面应用

基于 [TypeWords](https://github.com/zyronon/TypeWords) 的本地桌面版(Electron)。

## 目录结构

- `main.js` — Electron 主进程(自定义 `app://` 协议加载静态站)
- `preload.js` — 预加载脚本(给页面暴露桌面信息)
- `package.json` — 含 electron-builder 打包配置(NSIS 安装包)

## 开发(项目完全自包含,不依赖任何外部文件夹)

```bash
npm install          # 安装 Electron(已配国内镜像,.npmrc)
cd frontend && pnpm install   # 首次:安装前端依赖
npm run build:web    # 在项目内 frontend/ 构建静态站 → frontend/dist
npm run start        # 启动应用(加载 frontend/dist)
npm run dev          # 启动并打开开发者工具(F12 随时可开)
```

> 说明:`frontend/` 是 TypeWords 前端源码的**自有副本**(从上游复制而来)。改前端代码改这里,与上游参考副本无关。此文件夹连同整个 desktop/ 一起,就是完整项目。

## 打包安装包

```bash
npm run dist         # 生成 NSIS 安装包到 release/
```

## 数据存储

- 学习数据存在 IndexedDB,物理位置在 Electron 的 userData 目录(升级覆盖安装不会丢)
- 用户数据目录: `%APPDATA%\EnglishLearner`(打包后)

## macOS 首次打开

如果 macOS 提示“EnglishLearner 已损坏，无法打开”，这是未经过 Apple Developer 公证的应用被 Gatekeeper 拦截。将应用拖入“应用程序”后，在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/EnglishLearner.app
```

然后重新打开 EnglishLearner。也可以在 Finder 中右键应用并选择“打开”。
