// Persistent offline speech worker, owned by the Electron main process.
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function createLocalTts({ script, log = () => {}, python = process.env.TYPEWORDS_TTS_PYTHON } = {}) {
  const basePython = path.join(os.homedir(), '.base', 'bin', 'python3')
  python ||= fs.existsSync(basePython) ? basePython : 'python3'
  let child = null
  let starting = null
  let stopped = false
  let nextId = 0
  let retryAfter = 0
  const pending = new Map()

  function settleAll() {
    for (const finish of pending.values()) finish(null)
    pending.clear()
  }

  function start() {
    if (stopped || Date.now() < retryAfter) return Promise.resolve(false)
    if (starting) return starting
    starting = new Promise(resolve => {
      const worker = spawn(python, ['-u', script, String(process.pid)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONUNBUFFERED: '1' },
        windowsHide: true,
      })
      child = worker
      let ready = false
      const timer = setTimeout(() => {
        log('error', '本地语音模型启动超时')
        worker.kill('SIGKILL')
        resolve(false)
      }, 90000)
      const lines = createInterface({ input: worker.stdout })
      lines.on('line', line => {
        try {
          const message = JSON.parse(line)
          if (message.ready) {
            ready = true
            clearTimeout(timer)
            log('info', '本地语音模型已就绪 (Kokoro af_heart)')
            resolve(true)
          } else if (message.id) {
            if (message.error) log('warn', `本地语音合成失败: ${message.error}`)
            pending.get(message.id)?.(message.src || null)
          }
        } catch { log('warn', `本地语音进程输出: ${line.slice(0, 500)}`) }
      })
      worker.stderr.on('data', data => log('warn', String(data).slice(0, 2000)))
      worker.stdin.on('error', () => {})
      worker.on('error', err => {
        log('error', `本地语音进程启动失败: ${err.message}`)
        clearTimeout(timer)
        resolve(false)
      })
      worker.on('close', () => {
        clearTimeout(timer)
        lines.close()
        if (child === worker) {
          child = null
          starting = null
          retryAfter = Date.now() + 60000
          settleAll()
        }
        if (!ready) resolve(false)
      })
    })
    return starting
  }

  async function synthesize(text, cfg) {
    if (!await start() || stopped || !child) return null
    const worker = child
    return new Promise(resolve => {
      const id = ++nextId
      const timer = setTimeout(() => {
        log('error', '本地语音合成超时，重启工作进程')
        worker.kill('SIGKILL')
        finish(null)
      }, 90000)
      const finish = src => {
        clearTimeout(timer)
        pending.delete(id)
        resolve(src)
      }
      pending.set(id, finish)
      worker.stdin.write(JSON.stringify({ id, text: String(text).slice(0, 500), speed: cfg?.lengthScale ?? 1 }) + '\n', err => {
        if (err) finish(null)
      })
    })
  }

  function stop() {
    stopped = true
    settleAll()
    if (child) {
      // The worker's SIGTERM handler also stops an active macOS speech subprocess.
      const worker = child
      worker.kill('SIGTERM')
      const forceStop = setTimeout(() => {
        if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL')
      }, 2000)
      forceStop.unref()
    }
  }
  return { start, synthesize, stop }
}

function createSpeechFallback(online, local, log = () => {}) {
  let retryOnlineAt = 0
  return async (text, cfg) => {
    if (!String(text).trim()) return null
    if (Date.now() >= retryOnlineAt) {
      try {
        const src = await online(text, cfg)
        if (src) return src
      } catch (err) { log('warn', `Edge TTS 异常: ${err.message}`) }
      retryOnlineAt = Date.now() + 60000
      log('warn', 'Edge TTS 失败，60 秒内使用本地语音兜底')
    }
    return local.synthesize(text, cfg)
  }
}

module.exports = { createLocalTts, createSpeechFallback }
