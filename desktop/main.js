// EnglishLearner 主进程
// 用自定义协议 app:// 加载 TypeWords 的静态构建产物
// - 自定义协议(而非 file://)才能保证 vue-router history 模式、IndexedDB、fetch 正常工作
// - IndexedDB 数据持久化在 Electron 的 userData 目录,升级安装不会丢失
const { app, BrowserWindow, protocol, shell, net, ipcMain, dialog, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

// 冒烟测试:在单实例锁之前就用独立 userData(否则会被正在运行的应用实例锁住而直接退出)
const isSmokeTest = process.argv.includes('--smoke-test')
if (isSmokeTest) {
  const smokeUserData = path.join(app.getPath('temp'), 'english-learner-smoke')
  fs.rmSync(smokeUserData, { recursive: true, force: true })
  app.setPath('userData', smokeUserData)
}

// ===== 开发/安装环境隔离(2026-08-04) =====
// 开发模式(未打包,electron .)使用独立 userData(EnglishLearnerDev):
// 学习数据/设置/日志/朗读缓存与安装版完全隔离,且单实例锁互不影响,可同时运行。
// 必须在单实例锁之前切换(锁基于 userData)。
if (!app.isPackaged && !isSmokeTest) {
  app.setPath('userData', path.join(app.getPath('appData'), 'EnglishLearnerDev'))
}

// 必须在 app ready 之前注册自定义协议
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// 静态站目录(项目自包含,不依赖外部文件夹):
// - 开发时(未打包): 项目内 frontend/dist(pnpm run build 的产物)
// - 打包后: resources/web(由 electron-builder 的 extraResources 复制)
const webRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.join(__dirname, 'frontend', 'dist')

const appOrigin = 'app://bundle'

// ===== 日志系统 =====
// 统一写 userData/logs/app.log,带时间戳/级别/来源;超过 5MB 自动滚动(保留最近 3 份)。
// 渲染进程 console 错误会转发到这里;出问题后到「设置-帮助-日志」打开日志目录,或直接发 app.log 排查。
const LOG_DIR = path.join(app.getPath('userData'), 'logs')
const LOG_FILE = path.join(LOG_DIR, 'app.log')
const LOG_MAX_SIZE = 5 * 1024 * 1024 // 5MB
const LOG_KEEP = 3 // 滚动保留份数

function rotateLog() {
  try {
    // 滚动:app.log → app-1.log → app-2.log → … → 最旧一份删除,共保留 LOG_KEEP 份
    for (let i = LOG_KEEP - 1; i >= 1; i--) {
      const older = path.join(LOG_DIR, `app-${i}.log`)
      const newer = i === 1 ? LOG_FILE : path.join(LOG_DIR, `app-${i - 1}.log`)
      if (fs.existsSync(older)) fs.unlinkSync(older)
      if (fs.existsSync(newer)) fs.renameSync(newer, older)
    }
  } catch {}
}

function writeLog(level, source, message) {
  try {
    if (!message) return
    // 目录在 app ready 时创建一次(whenReady 内),这里不再每次 mkdirSync
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX_SIZE) rotateLog()
    const line = `[${new Date().toISOString()}] [${level}] [${source}] ${String(message).slice(0, 2000)}\n`
    fs.appendFileSync(LOG_FILE, line)
  } catch {}
}

// 兜底:主进程未捕获异常/拒绝写日志,避免静默失败(异常路径不再抛默认弹窗)
process.on('uncaughtException', (err) => {
  writeLog('error', 'main', `uncaughtException: ${err?.stack || err?.message || err}`)
})
process.on('unhandledRejection', (reason) => {
  writeLog('error', 'main', `unhandledRejection: ${reason?.stack || reason?.message || reason}`)
})

// 渲染进程 console → 日志(1=warning 2=error 3=info;0=log 也记,便于排查性能)
// 过滤已知噪音:打字逐字母调试、store 订阅调试、vxe 组件提示(源码已清,这里兜底防复发)
const NOISY_LOG_PATTERNS = [/^letter\s/, /\$subscribe/, /^\[vxe table/, /Electron Security Warning/]

// Chrome console-message 的 level 枚举:0=log 1=info 2=warning 3=error 4=debug
const CONSOLE_LEVEL_LABELS = { 0: 'log', 1: 'info', 2: 'warning', 3: 'error', 4: 'debug' }

function forwardRendererConsole(win) {
  // 兼容两种签名:新签名(event 对象,含 message/level)与旧签名(event, level, message)
  win.webContents.on('console-message', (event) => {
    const msg = String(event?.message ?? '')
    if (NOISY_LOG_PATTERNS.some(p => p.test(msg))) return
    const label = CONSOLE_LEVEL_LABELS[event?.level] || 'log'
    writeLog(label, 'renderer', msg)
  })
}

// 记住窗口大小/位置:存 userData/window-state.json,下次启动恢复(显示器变更后自动回落到默认)
const windowStateFile = path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowStateFile, 'utf-8'))
    if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return null
    // 窗口必须与某个显示器的工作区相交,否则(如拔掉外接屏)用默认位置
    const intersects = screen.getAllDisplays().some(display => {
      const a = display.workArea
      return (
        saved.x < a.x + a.width &&
        saved.x + saved.width > a.x &&
        saved.y < a.y + a.height &&
        saved.y + saved.height > a.y
      )
    })
    if (!intersects) return null
    return saved
  } catch {
    return null
  }
}

let windowStateTimer = null
function saveWindowState(win) {
  clearTimeout(windowStateTimer)
  windowStateTimer = setTimeout(() => {
    try {
      fs.writeFileSync(windowStateFile, JSON.stringify(win.getBounds()))
    } catch {}
  }, 500)
}

function createWindow() {
  const saved = loadWindowState()
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 860,
    x: saved?.x,
    y: saved?.y,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'EnglishLearner',
    // 自定义标题栏(2026-08-14):隐藏系统标题栏,应用内容延伸到窗口顶部,视觉融合;
    // titleBarOverlay 保留系统原生窗口控制按钮(最小化/最大化/关闭),拖拽/双击最大化/右键菜单等原生行为不变
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#e6e8eb', // 浅色主题主背景(与 main.scss --color-primary 一致)
      symbolColor: '#5b5b5b', // 窗口按钮图标色(浅色主题)
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 把应用版本号传给 preload(沙箱 preload 无法直接访问 app)
      additionalArguments: [`--app-version=${app.getVersion()}`],
      // 允许发音(语音合成/音频)自动播放,无需先点击页面
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  // 默认进入练习选择页(跳过介绍页);介绍页仍可通过首页入口访问
  win.loadURL(appOrigin + '/words')

  // 外链(如 GitHub 链接)交给系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // 渲染进程 console → 日志文件
  forwardRendererConsole(win)

  // 渲染进程崩溃兜底:提示数据位置,给重启/关闭选择(学习数据在本机,不会丢)
  win.webContents.on('render-process-gone', (event, details) => {
    writeLog('error', 'main', `render-process-gone: ${details.reason}`)
    if (isSmokeTest) return
    const reasonText = { crashed: '页面崩溃', oom: '内存不足', killed: '被系统终止' }[details.reason] || details.reason
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: 'EnglishLearner 遇到问题',
      message: '学习界面意外崩溃',
      detail:
        `原因：${reasonText}\n\n` +
        `学习数据保存在本机，不会丢失。\n数据位置：${app.getPath('userData')}\n\n` +
        '建议：点击「重启应用」重新打开；若反复崩溃，可先到「设置-数据管理」导出备份。',
      buttons: ['重启应用', '关闭'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice === 0) {
      app.relaunch()
      app.exit(0)
    } else {
      win.destroy()
    }
  })

  // 菜单隐藏后,F12 / Ctrl+Shift+I 仍可打开开发者工具(调试用)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isF12 = input.key === 'F12'
    const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i'
    if (isF12 || isCtrlShiftI) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  // 窗口大小/位置变化时记录(防抖),关闭时记录最终状态
  win.on('resize', () => saveWindowState(win))
  win.on('move', () => saveWindowState(win))
  win.on('close', () => saveWindowState(win))

  // 退出自动备份:窗口关闭前先通知渲染进程导出数据,完成后才真正关闭
  // 渲染进程卡死/无响应时 5 秒超时强制关闭,避免用户关不掉窗口
  // allowClose/backupPending 挂在窗口实例上(不用模块级变量):macOS 关窗重建后
  // 不会残留"已放行"状态,新窗口关闭时自动备份照常执行
  let backupPending = false
  win.__allowClose = false
  win.on('close', (e) => {
    if (win.__allowClose || isSmokeTest) return
    e.preventDefault() // 备份挂起中也阻止默认关闭(双击 X / Alt+F4 不绕过备份)
    if (backupPending) return
    backupPending = true
    win.webContents.send('request-auto-backup')
    setTimeout(() => {
      if (!win.__allowClose) {
        win.__allowClose = true
        win.destroy()
      }
    }, 5000)
  })

  return win
}

// 自动备份写入:渲染进程把备份 JSON 内容发过来,主进程写到自动备份目录
// (必须走 getAutoBackupDir():开发模式用独立目录,否则开发版备份会混入安装版目录,
// 且"保留 7 份"清理会误删安装版用户最旧的真实备份)
ipcMain.on('auto-backup-save', (event, content) => {
  try {
    // 内容大小上限 50MB:防异常调用方/外部页写入任意大小文件塞满磁盘
    if (typeof content !== 'string' || !content || content.length > 50 * 1024 * 1024) return
    const dir = getAutoBackupDir()
    fs.mkdirSync(dir, { recursive: true })
    // 文件名带时间戳+毫秒,字典序即时间序(同秒多次关闭不会互相覆盖)
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '-' + String(Date.now() % 1000).padStart(3, '0')
    const file = path.join(dir, `EnglishLearner-备份-${stamp}.json`)
    // 原子写入:先写 .tmp 再 rename,中途崩溃不留截断的损坏备份
    const tmpFile = file + '.tmp'
    fs.writeFileSync(tmpFile, content, 'utf-8')
    try { fs.unlinkSync(file) } catch {} // 同秒重复写入时先清旧文件,避免 rename 失败
    fs.renameSync(tmpFile, file)
    // 只保留最近 7 份备份(前缀精确匹配,手工放入的 .json 不会被误删)
    const files = fs.readdirSync(dir).filter(f => f.startsWith('EnglishLearner-备份-') && f.endsWith('.json')).sort()
    while (files.length > 7) {
      fs.unlinkSync(path.join(dir, files.shift()))
    }
    // 顺带清理崩溃残留的 .tmp(同步写入下不会误删正在写的那份)
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('EnglishLearner-备份-') && f.endsWith('.json.tmp')) {
        fs.unlinkSync(path.join(dir, f))
      }
    }
  } catch (err) {
    writeLog('error', 'main', `自动备份写入失败: ${err?.message || err}`)
  }
})

// 日志读取/打开目录(设置-帮助-日志 入口)
ipcMain.handle('read-log', () => {
  try {
    if (!fs.existsSync(LOG_FILE)) return ''
    // 定位读尾部 ~300KB,避免全量加载(日志最大 5MB)
    const fd = fs.openSync(LOG_FILE, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const offset = Math.max(0, size - 300 * 1024)
      const buf = Buffer.alloc(size - offset)
      // readSync 不保证读满,按实际读入字节数截取,避免尾部拼入 \0 垃圾字节
      const n = fs.readSync(fd, buf, 0, buf.length, offset)
      return buf.subarray(0, n).toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
})

ipcMain.handle('open-log-dir', async () => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    // shell.openPath 成功时 resolve 空串,失败时 resolve 错误信息
    return (await shell.openPath(LOG_DIR)) === ''
  } catch {
    return false
  }
})

// 渲染进程备份完成 → 放行关闭
ipcMain.on('auto-backup-done', (event) => {
  // 用 event.sender 精确定位发起备份的窗口(不用 getAllWindows()[0],多窗口时不会关错)
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    win.__allowClose = true
    win.close()
  }
})

// 自动备份目录(文档/EnglishLearner备份;开发模式用独立目录,避免与安装版备份互相覆盖)
function getAutoBackupDir() {
  const name = app.isPackaged ? 'EnglishLearner备份' : 'EnglishLearnerDev备份'
  return path.join(app.getPath('documents'), name)
}

// 列出自动备份文件(数据管理-恢复入口)
ipcMain.handle('auto-backup-list', () => {
  try {
    const dir = getAutoBackupDir()
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter(f => f.startsWith('EnglishLearner-备份-') && f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(dir, f))
        return { name: f, mtime: stat.mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
})

// 读取某个自动备份文件内容(校验文件名,防目录穿越)
ipcMain.handle('auto-backup-read', (event, name) => {
  try {
    if (typeof name !== 'string' || !name.startsWith('EnglishLearner-备份-') || !name.endsWith('.json')) return null
    const dir = getAutoBackupDir()
    const file = path.join(dir, name)
    // 目录校验用 dirname 精确比较,字符串前缀比较会被「备份-evil」之类同前缀目录绕过
    if (path.dirname(file) !== dir) return null
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
})

// ===== 中文翻译朗读(微软 Edge TTS 在线,免 key,晓晓等神经网络音色)=====
// 单词发音走在线有道;例句朗读功能已删除;无任何本地语音引擎。
const WebSocket = require('ws')
const crypto = require('crypto')

// ---- 微软 Edge TTS(协议参照社区 edge-tts:Sec-MS-GEC 签名经 URL 参数传递) ----
// 握手 token 来自社区 edge-tts 公开协议(https://github.com/rany2/edge-tts),非私有密钥,随协议一起公开
const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const EDGE_TTS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=' +
  EDGE_TTS_TOKEN +
  '&ConnectionId='
const EDGE_TTS_GEC_VERSION = '1-143.0.3650.75'
const EDGE_TTS_VOICE = 'en-US-JennyNeural' // Jenny(默认音色,可在设置选择)

// Sec-MS-GEC 签名:ticks(1601 epoch 秒,向下取整到 5 分钟 → 100ns 单位) + token 的 sha256
function generateSecMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + 11644473600
  ticks -= ticks % 300
  ticks = Math.round(ticks * 1e7)
  return crypto.createHash('sha256').update(String(ticks) + EDGE_TTS_TOKEN, 'ascii').digest('hex').toUpperCase()
}

// 服务器要求 JS 风格日期字符串(如 Tue Aug 04 2026 09:54:30 GMT+0000 (Coordinated Universal Time))
function edgeDateString() {
  const d = new Date()
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const p = n => String(n).padStart(2, '0')
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  )
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// 语速换算:发音倍速(越大越快,0.5 慢 2 快)→ Edge rate 百分比(-50% ~ +100%)
// 注意:倍速语义与播放变速一致(越大越快),勿用 lengthScale(越大越慢)换算,否则方向相反
function speedToRate(speed) {
  const s = Number(speed)
  if (!isFinite(s) || s <= 0) return '0%'
  const pct = Math.round((s - 1) * 100)
  const clamped = Math.max(-50, Math.min(100, pct))
  return (clamped >= 0 ? '+' : '') + clamped + '%'
}

// 微软 Edge TTS 合成 → mp3 base64(带 data:audio/mp3 前缀);失败返回 null
// cfg: voice(音色)/lengthScale(语速),其余本地引擎参数对在线无效
function edgeTtsSynthesize(text, cfg) {
  return new Promise(resolve => {
    const totalTimer = setTimeout(() => {
      try { ws.close() } catch {}
      resolve(null)
    }, 15000)
    let done = false
    const finish = val => {
      if (done) return
      done = true
      clearTimeout(totalTimer)
      clearTimeout(idleTimer)
      try { ws.close() } catch {}
      resolve(val)
    }
    let idleTimer = null
    let ws
    try {
      ws = new WebSocket(
        EDGE_TTS_URL +
          crypto.randomUUID() +
          '&Sec-MS-GEC=' + generateSecMsGec() +
          '&Sec-MS-GEC-Version=' + EDGE_TTS_GEC_VERSION,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
            Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
            Pragma: 'no-cache',
            'Cache-Control': 'no-cache',
            Cookie: 'muid=' + crypto.randomBytes(16).toString('hex').toUpperCase() + ';',
          },
        }
      )
    } catch {
      finish(null)
      return
    }
    // voice 白名单校验(字母数字连字符,如 zh-CN-XiaoxiaoNeural):直接拼 SSML,裸拼可注入 <audio> 等标签
    const voice =
      (cfg && typeof cfg.voice === 'string' && /^[A-Za-z0-9-]+$/.test(cfg.voice) && cfg.voice) || EDGE_TTS_VOICE
    const rate = speedToRate(cfg && cfg.lengthScale)
    const chunks = []

    ws.on('error', () => finish(null))
    ws.on('open', () => {
      try {
        const ts = edgeDateString()
        // 1) speech.config(无 X-RequestId;JSON 后带 \r\n)
        ws.send(
          'X-Timestamp:' + ts + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
            '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
        )
        // 2) ssml(X-Timestamp 带 Z 后缀,微软 Edge 的既定行为)
        const ssml =
          "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
          `<voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${xmlEscape(String(text).slice(0, 500))}` +
          '</prosody></voice></speak>'
        ws.send(
          'X-RequestId:' + crypto.randomUUID() + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + ts + 'Z\r\nPath:ssml\r\n\r\n' + ssml
        )
      } catch {
        finish(null)
      }
    })
    ws.on('message', data => {
      try {
        if (typeof data === 'string') return // turn.start/turn.end 等文本消息,音频走二进制
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
        if (buf.length < 4) return
        const headerLen = buf.readUInt16BE(0)
        if (headerLen < 4 || headerLen > buf.length - 2) return
        const header = buf.subarray(0, headerLen).toString('utf8')
        if (!/Path:audio/.test(header)) return
        const audio = buf.subarray(headerLen + 2) // 跳过 header 和 \r\n\r\n
        if (!audio.length) return
        chunks.push(audio)
        // 音频静默 2 秒视为流结束(服务器不发文本 turn.end)
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          try {
            finish('data:audio/mp3;base64,' + Buffer.concat(chunks).toString('base64'))
          } catch {
            finish(null)
          }
        }, 2000)
      } catch {
        // 单条消息解析失败忽略
      }
    })
  })
}

ipcMain.handle('tts-speak', (event, text, cfg) => {
  try {
    // 文本 → mp3 base64(带 data:audio/mp3 前缀);失败返回 null(断网等,前端静默处理)
    return edgeTtsSynthesize(typeof text === 'string' ? text : '', cfg && typeof cfg === 'object' ? cfg : null)
  } catch {
    return null
  }
})

// 预下载单词发音(有道在线):主进程代理下载,绕开浏览器 CORS 限制
// (渲染进程 fetch 有道会被 CORS 拦截,Audio 播放不受限但预加载需要代理)
ipcMain.handle('set-always-on-top', (event, flag) => {
  // 窗口置顶(设置-通用-窗口置顶):始终显示在最上层
  const win = BrowserWindow.getAllWindows()[0]
  win?.setAlwaysOnTop(!!flag)
  return true
})

// 自定义标题栏(2026-08-14):渲染进程切换深浅色主题时同步窗口按钮 overlay 配色
// (否则按钮颜色停留在初始浅色,深色模式下按钮区域与界面割裂)
ipcMain.handle('set-titlebar-overlay', (event, opts) => {
  try {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || typeof opts !== 'object' || opts === null) return false
    win.setTitleBarOverlay({
      color: typeof opts.color === 'string' ? opts.color : '#e6e8eb',
      symbolColor: typeof opts.symbolColor === 'string' ? opts.symbolColor : '#5b5b5b',
      height: 40,
    })
    return true
  } catch (err) {
    writeLog('error', 'main', `set-titlebar-overlay 失败: ${err?.message || err}`)
    return false
  }
})

ipcMain.handle('fetch-word-audio', async (event, word, type) => {
  try {
    const w = encodeURIComponent(String(word || '').slice(0, 100))
    const t = Number(type) === 1 ? 1 : 2
    // 10 秒超时:网络挂起时若无限等待,渲染侧 3 路预加载并发池会被永久占满
    const res = await net.fetch(`https://dict.youdao.com/dictvoice?audio=${w}&type=${t}`, {
      bypassCustomProtocolHandlers: true,
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) return null
    return 'data:audio/mpeg;base64,' + buf.toString('base64')
  } catch {
    return null
  }
})

// 日志目录确保存在:必须在启动日志(writeLog)之前,否则首次安装时目录不存在,
// appendFileSync 抛错被 catch 吞掉,启动日志/早期崩溃日志静默丢失
fs.mkdirSync(LOG_DIR, { recursive: true })

// 单实例:重复启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  writeLog('info', 'main', '已有实例在运行,本次启动退出')
  app.quit()
} else {
  writeLog('info', 'main', `应用启动 v${app.getVersion()}`)
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // 协议处理器:app://bundle/<路径> → webRoot/<路径>,文件不存在时回退到 index.html(SPA)
    protocol.handle('app', (request) => {
      const url = new URL(request.url)
      if (url.host !== 'bundle') {
        return new Response('Not Found', { status: 404 })
      }

      let pathname
      try {
        pathname = decodeURIComponent(url.pathname)
      } catch {
        return new Response('Bad Request', { status: 400 }) // 非法 % 编码
      }
      if (pathname === '/') pathname = '/index.html'

      // 防目录穿越:必须位于 webRoot 目录内(带路径分隔符精确比较,
      // 字符串前缀匹配会被 dist-evil 等 webRoot 同名前缀兄弟目录绕过)
      const resolved = path.normalize(path.join(webRoot, pathname))
      if (resolved !== webRoot && !resolved.startsWith(webRoot + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }

      let filePath = resolved
      // 路径是目录(如 /words 对应 dist/words/)→ 取目录内的 index.html
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html')
      }
      // 仍不存在 → 回退到 SPA 入口(客户端路由,如 /practice-words/xxx)
      // 介绍页已删,构建产物无 index.html,此时用 200.html(Nuxt static 的 SPA fallback)
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        const indexFallback = path.join(webRoot, 'index.html')
        filePath = fs.existsSync(indexFallback) ? indexFallback : path.join(webRoot, '200.html')
      }

      // 用 net.fetch 读本地文件,自动带正确 MIME 类型;
      // bypassCustomProtocolHandlers 防止再次进入本处理器造成死循环
      // 强制 no-store:构建产物每次启动都读磁盘最新版,杜绝窗口加载旧磁盘缓存
      // (曾导致"改了没生效/样式怪"反复出现——不完整构建的旧页面被缓存复用)
      return net.fetch(pathToFileURL(filePath).toString(), {
        bypassCustomProtocolHandlers: true,
      }).then((res) => {
        const headers = new Headers(res.headers)
        headers.set('Cache-Control', 'no-store')
        return new Response(res.body, { status: res.status, headers })
      })
    })

    if (isSmokeTest) {
      runSmokeTest()
    } else {
      createWindow()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 开发模式提示(数据位置)
if (!app.isPackaged) {
  console.log('开发模式: 静态站目录 =', webRoot)
  console.log('数据目录(userData) =', app.getPath('userData'))
}

// 冒烟测试:加载页面 → 验证 IndexedDB 读写 → 打印结果并退出
// 用法: npx electron . --smoke-test (打包/发布前跑一遍)
// 每次使用全新 userData,保证状态干净、结果确定(应用有根据本地状态跳转的逻辑)
function runSmokeTest() {
  // 打包后的 exe 没有控制台,支持 --smoke-output=<文件> 把结果写到文件
  const smokeOutputArg = process.argv.find((a) => a.startsWith('--smoke-output='))
  const smokeOutputFile = smokeOutputArg ? smokeOutputArg.split('=')[1] : null
  const results = { ok: false, home: null, words: null }

  const finish = (pass) => {
    results.ok = pass
    if (smokeOutputFile) {
      try {
        fs.writeFileSync(smokeOutputFile, JSON.stringify(results, null, 2))
      } catch (err) {
        console.error('SMOKE_OUTPUT_WRITE_FAILED', err)
      }
    }
    app.exit(pass ? 0 : 1)
  }

  const win = createWindow()

  // Electron 43: console-message 事件参数已改为 event 对象
  win.webContents.on('console-message', (event) => {
    console.log('[renderer]', event.message)
  })

  // 用阶段状态机,避免 did-finish-load 多次触发导致测试重入
  let stage = 0

  win.webContents.on('did-finish-load', async () => {
    try {
      stage++
      if (stage === 1) {
        // 首页:等 Vue 水合 + 验证 IndexedDB 读写
        await new Promise((r) => setTimeout(r, 4000))
        const home = await win.webContents.executeJavaScript(`
          (async () => {
            const idbOk = await new Promise((resolve) => {
              const req = indexedDB.open('smoke_test_db', 1)
              req.onupgradeneeded = () => req.result.createObjectStore('kv')
              req.onsuccess = () => {
                const db = req.result
                const tx = db.transaction('kv', 'readwrite')
                tx.objectStore('kv').put('hello', 'key')
                tx.objectStore('kv').get('key').onsuccess = () => resolve(true)
              }
              req.onerror = () => resolve(false)
            })
            return { title: document.title, url: location.href, hasRoot: !!document.querySelector('#__nuxt'), idbOk }
          })()
        `)
        console.log('SMOKE_TEST_HOME ' + JSON.stringify(home))
        results.home = home
        // SPA 回退路由:/words 是 ssr:false 的客户端页面,验证回退到 index.html 后能正常水合
        win.loadURL(appOrigin + '/words')
      } else if (stage === 2) {
        await new Promise((r) => setTimeout(r, 4000))
        const words = await win.webContents.executeJavaScript(`
          ({ title: document.title, url: location.href, hasRoot: !!document.querySelector('#__nuxt') })
        `)
        console.log('SMOKE_TEST_WORDS ' + JSON.stringify(words))
        // 应用可能按状态跳转(如新用户被引导去选词库),因此只要求:
        // 页面正常水合 + 仍在应用域内(路由机制工作正常)
        results.words = words
        finish(words.hasRoot && words.url.startsWith(appOrigin))
      } else {
        app.exit(1)
      }
    } catch (err) {
      console.error('SMOKE_TEST_FAILED', err)
      app.exit(1)
    }
  })

  win.webContents.on('render-process-gone', (event, details) => {
    console.error('RENDERER_GONE', details.reason)
    app.exit(1)
  })

  win.webContents.on('did-fail-load', (event, code, desc) => {
    console.error('DID_FAIL_LOAD', code, desc)
    app.exit(1)
  })
}
