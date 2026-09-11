import { ref, unref, type ComputedRef, type Ref } from 'vue'
import type { Word } from '../types'
import { playEdgeTts, usePlayWordAudio } from '../hooks/sound'
import { useSettingStore } from '../stores/setting'

export enum WordPlayTrigger {
  NewWord = 'newWord',
  RepeatWord = 'repeatWord',
  ResetSameWord = 'resetSameWord',
  RevealUnknown = 'revealUnknown',
  DictationReveal = 'dictationReveal',
  IdentifyWrongKey = 'identifyWrongKey',
  Typo = 'typo',
  DelRetry = 'delRetry',
  Manual = 'manual',
  Shortcut = 'shortcut',
}

export interface WordPracticeAudioOptions {
  word: Ref<Word>
  volumeIconRef: Ref<{ animateOnly?: (reset?: boolean) => void } | undefined> | ComputedRef<{ animateOnly?: (reset?: boolean) => void } | undefined>
  canSeeSentences?: () => boolean
}

export function useWordPracticeAudio({ word, volumeIconRef }: WordPracticeAudioOptions) {
  const settingStore = useSettingStore()
  const playWordAudio = usePlayWordAudio()

  /** 正在朗读的例句下标(播放中高亮,播放结束复位) */
  const highlightedSentenceIndex = ref(-1)

  /**
   * 朗读例句(微软 Edge TTS):与翻译共用音色 ttsVoice,语速独立 sentenceSoundSpeed。
   * playEdgeTts 内部自动命中预加载缓存(滑窗后台合成),未命中则在线合成并播放即缓存。
   */
  function playSentence(index: number, options?: { highlight?: boolean }) {
    const text = word.value.sentences?.[index]?.c
    if (!text) return
    const highlight = options?.highlight ?? false
    if (highlight) highlightedSentenceIndex.value = index
    playEdgeTts(text, {
      volume: settingStore.wordSoundVolume / 100,
      engine: {
        lengthScale: settingStore.sentenceSoundSpeed,
        voice: settingStore.ttsVoice,
      },
      onEnd: () => {
        if (highlight) highlightedSentenceIndex.value = -1
      },
    })
  }

  function playWord(
    trigger: WordPlayTrigger,
    options?: { resetIcon?: boolean; volumeRef?: { animateOnly?: (reset?: boolean) => void } }
  ) {
    const handle =
      trigger === WordPlayTrigger.RepeatWord ||
      trigger === WordPlayTrigger.Manual ||
      trigger === WordPlayTrigger.Shortcut

    playWordAudio(word.value.word, handle)

    const iconRef = options?.volumeRef ?? unref(volumeIconRef)
    iconRef?.animateOnly?.(options?.resetIcon ?? false)
  }

  return {
    highlightedSentenceIndex,
    playWord,
    playSentence,
    WordPlayTrigger,
  }
}
