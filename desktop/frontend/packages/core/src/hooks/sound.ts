import { onMounted, watchEffect } from 'vue'
import { useSettingStore } from '../stores/setting'
import { ref } from 'vue'

import { SoundFileOptions } from '../config/env'
import { getOrCreateEdgeAudio, recordAudioPlayback } from './preloadTts'

export function useSound(audioSrcList?: string[], audioFileLength?: number) {
  let audioList = ref<HTMLAudioElement[]>([])
  let audioLength = ref(1)
  let index = ref(0)
  // 放大倍数支持(按键音):audio.volume 上限 1,无法超过原始音量,统一接入 AudioContext gain 链,
  // play(volume, gain) 时按倍数放大;beep/correct 用默认 1 倍,音量行为不变
  let audioCtx: AudioContext | null = null
  let masterGain: GainNode | null = null

  onMounted(() => {
    if (audioSrcList) setAudio(audioSrcList, audioFileLength)
  })

  function ensureCtx() {
    if (!audioCtx) {
      audioCtx = new AudioContext()
      masterGain = audioCtx.createGain()
      masterGain.gain.value = 1
      masterGain.connect(audioCtx.destination)
    }
    // 无手势时创建为 suspended;打字/点击等手势内播放会自动 resume
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    return audioCtx
  }

  //这里同一个音频弄好几份是为了快速打字是，可同时发音
  function setAudio(audioSrcList2: string[], audioFileLength2?: number) {
    //@ts-ignore
    if (import.meta.server) return
    if (audioFileLength2) audioLength.value = audioFileLength2
    audioList.value = []
    try {
      const ctx = ensureCtx()
      for (let i = 0; i < audioLength.value; i++) {
        // 桌面版音效内嵌在应用内(/sound/),走本地路径;不要拼 ENV.RESOURCE_URL(远程 CDN 会失败/离线不可用)
        // createMediaElementSource 每个元素只能调用一次(每次 setAudio 都是新元素,安全)
        audioSrcList2.map(src => {
          const audio = new Audio(src)
          ctx.createMediaElementSource(audio).connect(masterGain!)
          audioList.value.push(audio)
        })
      }
    } catch {
      // AudioContext 不可用的极端环境(极少):退化为直接播放,无倍数放大
      audioList.value = []
      for (let i = 0; i < audioLength.value; i++) {
        audioSrcList2.map(src => audioList.value.push(new Audio(src)))
      }
    }
    index.value = 0
  }

  function play(volume: number = 100, gain: number = 1) {
    index.value++
    const applyVolume = (el: HTMLAudioElement | undefined | null) => {
      if (!el) return
      el.volume = Math.min(1, volume / 100)
      if (masterGain) masterGain.gain.value = Math.max(0, gain)
      // 音效文件缺失/加载失败时 play() 会 reject,必须捕获,否则产生 Uncaught 日志(见 NotSupportedError)
      el.play().catch(() => {})
    }
    if (audioList.value.length > 1 && audioList.value.length !== audioLength.value) {
      applyVolume(audioList.value[index.value % audioList.value.length])
    } else {
      applyVolume(audioList.value[index.value % audioLength.value])
    }
  }

  return { play, setAudio }
}

export function usePlayKeyboardAudio() {
  const settingStore = useSettingStore()
  const { play, setAudio } = useSound()

  watchEffect(() => {
    if (!SoundFileOptions.find(v => v.value === settingStore.keyboardSoundFile)) {
      settingStore.keyboardSoundFile = 'Alpacas'
    }
    let urlList = getAudioFileUrl(settingStore.keyboardSoundFile)
    setAudio(urlList, urlList.length === 1 ? 4 : 1)
  })

  function playAudio() {
    if (settingStore.keyboardSound) {
      // 倍数兜底:合法范围 10~100;旧数据(百分比/过渡版倍数)不在范围内一律按最低 10 倍处理
      const raw = settingStore.keyboardSoundVolume
      const gain = raw >= 10 && raw <= 100 ? raw : 10
      play(100, gain)
    }
  }

  return playAudio
}

export function usePlayBeep() {
  const settingStore = useSettingStore()
  const { play } = useSound([`/sound/beep.wav`], 1)

  function playAudio() {
    if (settingStore.effectSound) {
      play(settingStore.effectSoundVolume)
    }
  }

  return playAudio
}

export function usePlayCorrect() {
  const settingStore = useSettingStore()
  const { play } = useSound([`/sound/correct.wav`], 1)

  function playAudio() {
    if (settingStore.effectSound) {
      play(settingStore.effectSoundVolume)
    }
  }

  return playAudio
}

const activeWordPlayCountMap = new Map<string, number>()

export function resetActiveWordPlayCount(word: string) {
  if (!word) return
  activeWordPlayCountMap.delete(word.trim().toLowerCase())
}

let wordPlayRequest = 0
let ttsPlayRequest = 0
let activeWordAudio: HTMLAudioElement | null = null
let activeTtsAudio: HTMLAudioElement | null = null

export function cancelWordPracticeAudio() {
  wordPlayRequest++
  if (activeWordAudio) {
    activeWordAudio.onended = null
    activeWordAudio.onerror = null
    activeWordAudio.pause()
    activeWordAudio.currentTime = 0
  }
  cancelTtsAudio()
}

/** 停止正在播放的 TTS 音频(切换/打断时调用) */
export function cancelTtsAudio() {
  ttsPlayRequest++
  if (activeTtsAudio) {
    activeTtsAudio.onended = null
    activeTtsAudio.onerror = null
    activeTtsAudio.pause()
    activeTtsAudio = null
  }
}

/** 中文朗读(微软 Edge TTS)可调参数:音色/语速 */
export type EdgeTtsConfig = {
  voice?: string
  lengthScale?: number
}

/**
 * 中文朗读:主进程微软 Edge TTS 在线合成(mp3 base64),音质最佳。
 * 网络不可用时返回 false(调用方按需处理)。
 */
export async function playEdgeTts(
  text: string,
  options: { volume?: number; rate?: number; onEnd?: () => void; engine?: EdgeTtsConfig } = {}
): Promise<boolean> {
  if (!text || typeof window === 'undefined') return false
  cancelTtsAudio()
  const request = ttsPlayRequest
  try {
    const src = await getOrCreateEdgeAudio(text, options.engine?.voice, options.engine?.lengthScale, true)
    if (request !== ttsPlayRequest) return false
    if (!src) {
      // 合成失败(断网/接口异常):派发事件,由界面层做节流提示
      try {
        window.dispatchEvent(new CustomEvent('edge-tts-fail'))
      } catch {}
      return false
    }
    // 主进程返回带 mime 前缀的 data URL(Edge TTS = mp3,本地引擎 = wav)
    const audio = new Audio(src.startsWith('data:') ? src : 'data:audio/wav;base64,' + src)
    audio.volume = options.volume ?? 1
    if (options.rate && options.rate !== 1) audio.playbackRate = options.rate
    const finish = () => {
      if (activeTtsAudio === audio) activeTtsAudio = null
      options.onEnd?.()
    }
    audio.onended = finish
    audio.onerror = finish
    activeTtsAudio = audio
    await audio.play()
    recordAudioPlayback(text, options.engine?.voice, options.engine?.lengthScale)
    return true
  } catch {
    return false
  }
}

export function usePlayWordAudio() {
  const settingStore = useSettingStore()

  async function playAudio(word: string, handle: boolean = true, onEnd?: () => void) {
    if (!word?.trim()) return
    cancelWordPracticeAudio()
    const request = wordPlayRequest
    const voice = settingStore.ttsVoice
    let playbackRate = settingStore.wordSoundSpeed
    if (handle) {
      const key = word.trim().toLowerCase()
      const count = activeWordPlayCountMap.get(key) ?? 0
      if (count % 3 !== 0) playbackRate *= 0.75
      activeWordPlayCountMap.set(key, count + 1)
    }
    const src = await getOrCreateEdgeAudio(word.trim(), voice, 1, true)
    // 切词、取消或更换音色后，不播放刚刚完成的旧请求。
    if (request !== wordPlayRequest || voice !== settingStore.ttsVoice) return
    if (!src) {
      window.dispatchEvent(new CustomEvent('edge-tts-fail'))
      onEnd?.()
      return
    }
    const audio = new Audio(src)
    activeWordAudio = audio
    let finished = false
    const finish = () => {
      if (finished || request !== wordPlayRequest) return
      finished = true
      if (activeWordAudio === audio) activeWordAudio = null
      onEnd?.()
    }
    audio.onended = finish
    audio.onerror = finish
    audio.volume = settingStore.wordSoundVolume / 100
    audio.playbackRate = playbackRate
    try {
      await audio.play()
      recordAudioPlayback(word.trim(), voice, 1)
    } catch { finish() }
  }

  return playAudio
}

export function usePlayAudio(url: string) {
  new Audio(url).play().catch(() => {}) // 音效文件缺失时静默,避免 Uncaught NotSupportedError
}

export function getAudioFileUrl(name: string) {
  // 按键音效均为 mp3(机械轴体声音,来自 qwerty-learner/kbsim);文件名含空格,URL 需编码
  return [`/sound/key-sounds/${encodeURIComponent(name)}.mp3`]
}
