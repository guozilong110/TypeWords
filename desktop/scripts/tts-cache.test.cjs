const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '../frontend')] }))
const source = fs.readFileSync(path.join(__dirname, '../frontend/packages/core/src/hooks/preloadTts.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function setup(disk = new Map(), synthesize = async (text, config) => `data:${text}:${config.voice}:${config.lengthScale}`) {
  const settings = {}
  const calls = []
  const timers = new Set()
  const exports = {}
  const mocks = {
    'idb-keyval': { get: async key => disk.get(key), set: async (key, value) => disk.set(key, value), del: async key => disk.delete(key) },
    '../stores/setting': { useSettingStore: () => settings },
    '../utils/transSpeech': { buildTransSpeechText: () => '' },
    '../utils/wordLookup': { splitEnglishText: text => (text.match(/[a-zA-Z]+(?:'[a-zA-Z]+)?|[^a-zA-Z]+/g) || []).map(text => ({ text, isWord: /[a-zA-Z]/.test(text) })) },
  }
  vm.runInNewContext(compiled, {
    exports, require: name => { assert.ok(mocks[name], name); return mocks[name] },
    window: { desktop: { speakText: async (...args) => { calls.push(args); return synthesize(...args) } } },
    setTimeout: fn => { timers.add(fn); return fn }, clearTimeout: fn => timers.delete(fn),
  })
  return { api: exports, calls, disk, settings }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('preload and clicks share one synthesis; voice and speed variants coexist', async () => {
  const { api, calls } = setup()
  const [a, b] = await Promise.all([api.prefetchWordAudio('cancel', 'voice-a'), api.getOrCreateEdgeAudio('cancel', 'voice-a', 1, true)])
  assert.equal(a, b)
  assert.equal(calls.length, 1)
  await api.getOrCreateEdgeAudio('cancel', 'voice-b', 1)
  await api.getOrCreateEdgeAudio('cancel', 'voice-a', 1.5)
  await api.getOrCreateEdgeAudio('cancel', 'voice-a', 1)
  assert.equal(calls.length, 3)
  api.clearTtsCaches()
  await api.getOrCreateEdgeAudio('cancel', 'voice-a', 1)
  assert.equal(calls.length, 3, 'leaving practice must preserve shared cache')
})

test('persisted word audio is reused in a fresh session without network', async () => {
  const first = setup()
  await first.api.prefetchWordAudio('customer', 'voice-a')
  first.api.clearTtsCaches()
  await tick()
  const second = setup(first.disk)
  assert.equal(await second.api.prefetchWordAudio('customer', 'voice-a'), 'data:customer:voice-a:1')
  assert.equal(second.calls.length, 0)
})

test('every sentence token is prefetched once and reused on click', async () => {
  const { api, calls } = setup()
  api.prefetchEnglishWords('The customer called to cancel. The customer called.', 'voice-a')
  await tick()
  assert.deepEqual(calls.map(([text]) => text).sort(), ['The', 'called', 'cancel', 'customer', 'to'])
  await api.getOrCreateEdgeAudio('customer', 'voice-a', 1, true)
  assert.equal(calls.length, 5)
})

test('global synthesis concurrency is bounded and failures can retry', async () => {
  let active = 0, peak = 0
  const { api, calls } = setup(new Map(), async text => {
    active++; peak = Math.max(peak, active)
    await tick(); active--
    return text === 'failed' ? null : `data:${text}`
  })
  await Promise.all(Array.from({ length: 12 }, (_, i) => api.prefetchWordAudio(`word${i}`, 'voice-a')))
  assert.equal(peak, 3)
  await api.prefetchWordAudio('failed', 'voice-a')
  await api.prefetchWordAudio('failed', 'voice-a')
  assert.equal(calls.filter(([text]) => text === 'failed').length, 2)
})

test('clearing cache discards queued jobs and in-flight results', async () => {
  const releases = []
  const { api, disk } = setup(new Map(), () => new Promise(resolve => releases.push(resolve)))
  const requests = Array.from({ length: 6 }, (_, i) => api.prefetchWordAudio(`word${i}`, 'voice-a'))
  await tick()
  assert.equal(releases.length, 3)
  await api.clearAllTtsCaches()
  releases.forEach(resolve => resolve('data:old'))
  assert.deepEqual(await Promise.all(requests), Array(6).fill(null))
  assert.equal(api.getCachedWordAudio('word0', 'voice-a'), null)
  assert.equal(disk.has('tts-trans-cache'), false)
})

function setupPlayback(cacheApi, settings) {
  const audio = []
  const soundSource = fs.readFileSync(path.join(__dirname, '../frontend/packages/core/src/hooks/sound.ts'), 'utf8').replace('import.meta.server', 'false')
  const code = ts.transpileModule(soundSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  const mocks = {
    vue: { ref: value => ({ value }), onMounted: () => {}, watchEffect: () => {} },
    '../stores/setting': { useSettingStore: () => settings },
    '../config/env': {}, './preloadTts': cacheApi,
  }
  vm.runInNewContext(code, {
    exports, require: name => mocks[name], window: { dispatchEvent() {} },
    Audio: class {
      constructor(src) { this.src = src; audio.push(this) }
      async play() { this.played = true }
      pause() { this.paused = true }
    },
  })
  return { api: exports, audio }
}

test('word playback uses selected voice and shared cache even for repeated slow playback', async () => {
  const cache = setup()
  const settings = { ttsVoice: 'voice-a', wordSoundSpeed: 1.2, wordSoundVolume: 60 }
  const player = setupPlayback(cache.api, settings)
  await cache.api.prefetchWordAudio('cancel', settings.ttsVoice)
  await player.api.usePlayWordAudio()('cancel')
  await player.api.usePlayWordAudio()('cancel')
  assert.equal(cache.calls.length, 1)
  assert.equal(player.audio[0].src, 'data:cancel:voice-a:1')
  assert.equal(player.audio[0].volume, 0.6)
  assert.equal(player.audio[0].playbackRate, 1.2)
  assert.ok(Math.abs(player.audio[1].playbackRate - 0.9) < 0.001)
  settings.ttsVoice = 'voice-b'
  await player.api.usePlayWordAudio()('cancel')
  assert.equal(player.audio[2].src, 'data:cancel:voice-b:1')
  assert.equal(cache.calls.length, 2)
})

test('cancelled pending word synthesis cannot start stale playback', async () => {
  let release
  const cache = setup(new Map(), () => new Promise(resolve => { release = resolve }))
  const player = setupPlayback(cache.api, { ttsVoice: 'voice-a', wordSoundSpeed: 1, wordSoundVolume: 60 })
  const playing = player.api.usePlayWordAudio()('cancel')
  await tick()
  player.api.cancelWordPracticeAudio()
  release('data:cancel')
  await playing
  assert.equal(player.audio.length, 0)
})

test('sentence typing uses selected voice and cached word without manual-repeat slowdown', async () => {
  const cache = setup()
  const settings = { ttsVoice: 'en-GB-SoniaNeural', wordSoundSpeed: 1.2, wordSoundVolume: 60 }
  const player = setupPlayback(cache.api, settings)
  const source = fs.readFileSync(path.join(__dirname, '../frontend/packages/core/src/components/word/TypeWord.vue'), 'utf8')
  const start = source.indexOf('function playSentenceWord(')
  const end = source.indexOf('/** 判断当前位置', start)
  assert.ok(start >= 0 && end > start)
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const requests = []
  const play = player.api.usePlayWordAudio()
  const context = {
    props: { word: { sentences: [{ c: 'The car had been rigged.' }] } },
    settingStore: { ...settings, wordSound: true },
    playSentenceTokenAudio: (...args) => { requests.push(play(...args)) },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  await cache.api.prefetchWordAudio('car', settings.ttsVoice)
  vm.runInContext('playSentenceWord(0, 4); playSentenceWord(0, 3, true)', context)
  await Promise.all(requests)
  assert.equal(cache.calls.length, 1)
  assert.equal(player.audio.at(-1).src, 'data:car:en-GB-SoniaNeural:1')
  assert.equal(player.audio.at(-1).playbackRate, 1.2)
})

test('10000-entry cache evicts least played; lookups and preload do not inflate frequency', async () => {
  const { api, disk } = setup()
  await api.ensurePersistedCacheLoaded()
  for (let i = 0; i < 10000; i++) api.cacheTransAudio(`word${i}`, `data:${i}`, 'voice-a', 1)
  api.recordAudioPlayback('word0', 'voice-a', 1)
  api.recordAudioPlayback('word0', 'voice-a', 1)
  for (let i = 0; i < 5; i++) await api.prefetchWordAudio('word1', 'voice-a')
  api.cacheTransAudio('extra', 'data:extra', 'voice-a', 1)
  assert.equal(api.getCachedWordAudio('word0', 'voice-a'), 'data:0')
  assert.equal(api.getCachedWordAudio('word1', 'voice-a'), null)
  assert.equal(api.getCachedWordAudio('extra', 'voice-a'), 'data:extra')
  api.clearTtsCaches()
  await tick()
  assert.equal(disk.get('tts-trans-cache').length, 10000)
  assert.equal(disk.get('tts-trans-cache').find(item => item.text === 'word0').playCount, 2)
  const restored = setup(disk)
  await restored.api.ensurePersistedCacheLoaded()
  restored.api.cacheTransAudio('another', 'data:another', 'voice-a', 1)
  assert.equal(restored.api.getCachedWordAudio('word0', 'voice-a'), 'data:0')
})

test('legacy cache counters default to zero; equal frequency evicts oldest playback', async () => {
  const disk = new Map([['tts-trans-cache', Array.from({ length: 10000 }, (_, i) => ({
    text: `word${i}`, src: `data:${i}`, voice: 'voice-a', speed: 1,
    ts: i === 1 ? 0 : i + 10,
  }))]])
  const { api } = setup(disk)
  await api.ensurePersistedCacheLoaded()
  api.cacheTransAudio('extra', 'data:extra', 'voice-a', 1)
  assert.equal(api.getCachedWordAudio('word1', 'voice-a'), null)
  assert.equal(api.getCachedWordAudio('word0', 'voice-a'), 'data:0')
})

test('successful playback increments counters; failed playback and prefetch do not', async () => {
  const cache = setup()
  const settings = { ttsVoice: 'voice-a', wordSoundSpeed: 1, wordSoundVolume: 60 }
  const player = setupPlayback(cache.api, settings)
  await cache.api.prefetchWordAudio('cancel', 'voice-a')
  await player.api.usePlayWordAudio()('cancel', false)
  await player.api.playEdgeTts('A sentence.', { engine: { voice: 'voice-a', lengthScale: 1.2 } })
  player.audio[0].constructor.prototype.play = async () => { throw new Error('playback denied') }
  await player.api.usePlayWordAudio()('cancel', false)
  cache.api.clearTtsCaches()
  await tick()
  const entries = cache.disk.get('tts-trans-cache')
  assert.equal(entries.find(item => item.text === 'cancel').playCount, 1)
  assert.equal(entries.find(item => item.text === 'A sentence.').playCount, 1)
})


test('cache limit can shrink and grow while retaining most played audio', async () => {
  const { api, settings, disk } = setup()
  await api.ensurePersistedCacheLoaded()
  assert.equal(api.getTtsCacheLimit(), 10000)
  for (let i = 0; i < 5; i++) api.cacheTransAudio(`word${i}`, `data:${i}`, 'voice-a')
  api.recordAudioPlayback('word0', 'voice-a')
  settings.ttsCacheLimit = 2
  await api.applyTtsCacheLimit()
  assert.equal(disk.get('tts-trans-cache').length, 2)
  assert.equal(api.getCachedWordAudio('word0', 'voice-a'), 'data:0')
  settings.ttsCacheLimit = 3
  api.cacheTransAudio('extra', 'data:extra', 'voice-a')
  await api.applyTtsCacheLimit()
  assert.equal(disk.get('tts-trans-cache').length, 3)
  for (const value of [0, -1, 1.5, NaN]) {
    settings.ttsCacheLimit = value
    assert.equal(api.getTtsCacheLimit(), 10000)
  }
})

test('Jenny is the synthesis default; legacy default-voice caches retain original voice', async () => {
  const disk = new Map([['tts-trans-cache', [{ text: 'old', src: 'data:old', ts: 0 }]]])
  const { api, calls } = setup(disk)
  await api.getOrCreateEdgeAudio('hello')
  assert.equal(calls[0][1].voice, 'en-US-JennyNeural')
  assert.equal(api.getCachedTransAudio('old'), null)
  assert.equal(api.getCachedTransAudio('old', 'zh-CN-XiaoxiaoNeural'), 'data:old')
})
