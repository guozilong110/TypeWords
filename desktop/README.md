# EnglishLearner — 英语学习桌面应用

本项目基于 [Aliboder/english-learner](https://github.com/Aliboder/english-learner) 开发，当前版本为面向桌面端的 Electron 应用。

## 基于上游项目的变动

相对于上游项目，本仓库的主要变动包括：

- 将应用整理为可独立运行的 Electron 桌面项目，前端源码、主进程、预加载脚本、构建配置和资源均放在本仓库内。
- 扩充内置词库，覆盖中学生、大学生及多个考试/学习场景，并完善本地词典索引、查词和搜索建议。
- 重构练习流程：增加例句跟打、例句数量设置、纯字母输入、目标词高亮、自动进入例句、例句完成后自动切词，以及双击空格跳过例句。
- 改进学习数据和复习逻辑，修复到期复习、重学、结算、掌握状态及按词典隔离等场景的数据准确性问题。
- 增加和优化导入、失败重试、空白导入、备份恢复及损坏数据拦截，增强数据安全性。
- 重做设置和界面体验：设置分类、可拖拽设置窗口、主题适配、自定义标题栏、进度显示、词表卡片、学习记录表格和新手引导。
- 增强语音功能：支持单词、翻译和例句的语音设置，统一音色配置，增加持久化 LFU 音频缓存，并支持首次输入例句单词时的发音反馈。
- 修复输入、暂停计时、查词竞态、粘贴多字符、弹窗生命周期、监听器清理及英美音缓存隔离等稳定性问题。
- 增加 Windows/macOS 打包和 GitHub Actions 发布流程，补充 macOS 首次启动说明、更新检查入口和版本更新记录。
- 当前最新修复支持在正在输入的例句中点击任意英文单词，查看该词的释义并播放发音。

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
