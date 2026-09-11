import type { Word } from '../types'
import { del, get, set } from 'idb-keyval'
import { useSettingStore } from '../stores/setting'
import { buildTransSpeechText } from '../utils/transSpeech'
import { splitEnglishText } from '../utils/wordLookup'

// 全局共享：单词、翻译和例句统一按文本 + 音色 + 合成语速缓存，跨页面、跨会话复用。
const PERSIST_KEY = 'tts-trans-cache'
const DEFAULT_CACHE_LIMIT = 10000
const DEFAULT_VOICE = 'en-US-JennyNeural'
type Entry = { text: string; src: string; voice: string; speed: number; ts: number; playCount: number }
const cache = new Map<string, Entry>()
let loading: Promise<void> | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let writes: Promise<unknown> = Promise.resolve()
let generation = 0

function audioKey(text: string, voice = DEFAULT_VOICE, speed = 1) {
  return JSON.stringify([text.trim(), voice, speed])
}

export function getTtsCacheLimit(): number {
  const value = Number(useSettingStore().ttsCacheLimit)
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_CACHE_LIMIT
}

export async function applyTtsCacheLimit() {
  await ensurePersistedCacheLoaded()
  trimCache()
  await flushPersistNow()
}

function trimCache(limit = getTtsCacheLimit()) {
  if (cache.size <= limit) return
  // LFU：播放次数相同时，先淘汰最久未播放（或最早缓存）的条目。
  const candidates = [...cache.entries()].sort((a, b) =>
    a[1].playCount - b[1].playCount || a[1].ts - b[1].ts
  )
  for (const [key] of candidates.slice(0, cache.size - limit)) cache.delete(key)
}

export function ensurePersistedCacheLoaded(_force = false): Promise<void> {
  if (!loading) {
    const epoch = generation
    loading = (async () => {
      try {
        const list = await get(PERSIST_KEY)
        if (epoch !== generation || !Array.isArray(list)) return
        for (const item of [...list].reverse()) {
          if (!item?.text || !item?.src) continue
          const entry = { ...item, voice: item.voice ?? 'zh-CN-XiaoxiaoNeural', speed: item.speed ?? 1,
            playCount: Number.isSafeInteger(item.playCount) && item.playCount >= 0 ? item.playCount : 0,
            ts: item.ts ?? 0,
          }
          const key = audioKey(entry.text, entry.voice, entry.speed)
          if (!cache.has(key)) cache.set(key, entry)
        }
        trimCache()
      } catch { /* IndexedDB 不可用时仍使用内存缓存 */ }
    })()
  }
  return loading
}

function flushPersistNow() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  const list = [...cache.values()].reverse()
  writes = writes.catch(() => {}).then(() => set(PERSIST_KEY, list)).catch(() => {})
  return writes
}

export function getCachedTransAudio(text: string, voice = DEFAULT_VOICE, speed = 1): string | null {
  const key = audioKey(text, voice, speed)
  const item = cache.get(key)
  if (!item) return null
  return item.src
}

export function cacheTransAudio(text: string, src: string, voice = DEFAULT_VOICE, speed = 1) {
  if (!text.trim() || !src) return
  const key = audioKey(text, voice, speed)
  const existing = cache.get(key)
  // 新语音入库前为其腾出位置，保留已有条目的播放统计。
  if (!existing) trimCache(getTtsCacheLimit() - 1)
  cache.set(key, { text: text.trim(), src, voice, speed, ts: existing?.ts ?? Date.now(), playCount: existing?.playCount ?? 0 })
  schedulePersist()
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(flushPersistNow, 1000)
}

/** 仅在音频成功开始播放后计数；预加载、查询、失败和取消请求不增加播放次数。 */
export function recordAudioPlayback(text: string, voice = DEFAULT_VOICE, speed = 1) {
  const item = cache.get(audioKey(text, voice, speed))
  if (!item) return
  item.playCount++
  item.ts = Date.now()
  schedulePersist()
}

type Job = { key: string; run: () => Promise<void>; resolve: (src: string | null) => void }
const queue: Job[] = []
const pending = new Map<string, Promise<string | null>>()
let workers = 0

function drain() {
  while (workers < 3 && queue.length) {
    const job = queue.shift()!
    workers++
    void job.run().finally(() => { workers--; drain() })
  }
}

/** 缓存优先；预加载与播放共享在途请求，点击时将等待中的任务提前。 */
export async function getOrCreateEdgeAudio(text: string, voice = DEFAULT_VOICE, speed = 1, priority = false): Promise<string | null> {
  text = text.trim()
  if (!text || typeof window === 'undefined') return null
  await ensurePersistedCacheLoaded()
  const cached = getCachedTransAudio(text, voice, speed)
  if (cached) return cached
  const key = audioKey(text, voice, speed)
  if (pending.has(key)) {
    if (priority) {
      const index = queue.findIndex(job => job.key === key)
      if (index > 0) queue.unshift(queue.splice(index, 1)[0])
    }
    return pending.get(key)!
  }
  const epoch = generation
  let resolve!: (src: string | null) => void
  const result = new Promise<string | null>(done => { resolve = done })
  pending.set(key, result)
  const job: Job = {
    key, resolve,
    async run() {
      try {
        const src = await (window as any).desktop?.speakText?.(text, { voice, lengthScale: speed })
        if (epoch !== generation) { resolve(null); return }
        if (src) cacheTransAudio(text, src, voice, speed)
        resolve(src || null)
      } catch { resolve(null) }
      finally { if (pending.get(key) === result) pending.delete(key) }
    },
  }
  if (priority) queue.unshift(job)
  else queue.push(job)
  drain()
  return result
}

// 单词保留大小写与词形，不把不同原文（例如 US/us）错误地合并。
export function getCachedWordAudio(word: string, voice: string) {
  return getCachedTransAudio(word.trim(), voice, 1)
}

export function prefetchWordAudio(word: string, voice: string) {
  // 单词缓存标准语速，播放时变速，重复慢读也无需重新合成。
  return getOrCreateEdgeAudio(word.trim(), voice, 1)
}

export function prefetchEnglishWords(text: string, voice: string) {
  const words = new Set(splitEnglishText(text).filter(token => token.isWord).map(token => token.text))
  for (const word of words) void prefetchWordAudio(word, voice)
}

/** 离开练习页仅刷盘，缓存仍供全局使用。 */
export function clearTtsCaches() {
  void flushPersistNow()
}

/** 用户主动清理时，防止未完成的合成请求重新写回缓存。 */
export async function clearAllTtsCaches() {
  generation++
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  cache.clear()
  for (const job of queue.splice(0)) job.resolve(null)
  pending.clear()
  await loading
  await writes
  try { await del(PERSIST_KEY) } catch { /* 清理失败不影响播放 */ }
}

export function schedulePrefetch(
  words: Word[], index: number,
  opts: { soundType?: string; voice: string; speed: number; sentenceSpeed: number }
) {
  if (!Array.isArray(words) || !words.length) return
  const current = words[index]
  if (current?.word) {
    void prefetchWordAudio(current.word, opts.voice)
    // 当前例句中的每个可点击单词优先准备，与 ClickableEnglishText 使用同一分词器。
    for (const sentence of current.sentences ?? []) {
      if (!sentence?.c) continue
      prefetchEnglishWords(sentence.c, opts.voice)
      void getOrCreateEdgeAudio(sentence.c, opts.voice, opts.sentenceSpeed)
    }
  }
  const store = useSettingStore()
  for (const word of words.slice(index + 1, index + 9)) {
    if (!word?.word) continue
    void prefetchWordAudio(word.word, opts.voice)
    const text = buildTransSpeechText(word.trans, store.showDetailedTrans, store.limitTransSpeech)
    if (text) void getOrCreateEdgeAudio(text, opts.voice, opts.speed)
    for (const sentence of word.sentences ?? []) {
      if (!sentence?.c) continue
      void getOrCreateEdgeAudio(sentence.c, opts.voice, opts.sentenceSpeed)
      prefetchEnglishWords(sentence.c, opts.voice)
    }
  }
}
