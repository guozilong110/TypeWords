<script setup lang="ts">
import { Option, Select, Slider, VolumeIcon } from '@english-learner/base'
import SettingItem from './SettingItem.vue'
import { playEdgeTts } from '../../hooks/sound.ts'
import { useSettingStore } from '../../stores/setting'
import { applyTtsCacheLimit, getTtsCacheLimit } from '../../hooks/preloadTts'

const props = defineProps<{
  /** 分组标题 */
  title: string
  /** 试听文本 */
  sample: string
  /** 试听音量(0-100) */
  volume: number
  /** 翻译朗读语速(transSoundSpeed,与单词发音 wordSoundSpeed 独立,合成变速,音调不变) */
  speed: number
  /** 显示翻译语速滑条(顶部「总倍速」展开后隐藏,避免重复) */
  showSpeed?: boolean
}>()

const settingStore = useSettingStore()

/** 各语言的推荐音色优先，其余音色按名称排列。分组标题不可选。 */
const VOICE_GROUPS = [
  {
    locale: 'en-GB', label: '英式英语',
    recommended: [['Sonia', '女'], ['Ryan', '男']],
    other: [['Libby', '女'], ['Maisie', '女'], ['Thomas', '男']],
  },
  {
    locale: 'en-US', label: '美式英语',
    recommended: [['EmmaMultilingual', '女 · 多语言'], ['AndrewMultilingual', '男 · 多语言'], ['Jenny', '女'], ['Guy', '男']],
    other: [
      ['Ana', '女'], ['Andrew', '男'], ['Aria', '女'], ['Ava', '女'],
      ['AvaMultilingual', '女 · 多语言'], ['Brian', '男'], ['BrianMultilingual', '男 · 多语言'],
      ['Christopher', '男'], ['Emma', '女'], ['Eric', '男'], ['Michelle', '女'], ['Roger', '男'], ['Steffan', '男'],
    ],
  },
  {
    locale: 'zh-CN', label: '中国大陆普通话',
    recommended: [['Xiaoxiao', '女', '晓晓'], ['Yunxi', '男', '云希']],
    other: [['Xiaoyi', '女', '晓伊'], ['Yunjian', '男', '云健'], ['Yunxia', '男', '云夏'], ['Yunyang', '男', '云扬']],
  },
]

const EDGE_TTS_VOICES = VOICE_GROUPS.flatMap(group =>
  (['recommended', 'other'] as const).flatMap(category => {
    const categoryLabel = category === 'recommended' ? '推荐' : '其他'
    return [
      { value: `${group.locale}-${category}`, label: `${group.label} · ${categoryLabel}`, disabled: true },
      ...group[category].map(([name, gender, chineseName]) => ({
        value: `${group.locale}-${name}Neural`,
        label: `${chineseName || name}（${gender} · ${group.label}）`,
        disabled: false,
      })),
    ]
  })
)

function updateCacheLimit(event: Event) {
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  if (Number.isSafeInteger(value) && value > 0) {
    settingStore.ttsCacheLimit = value
    void applyTtsCacheLimit()
  }
  input.value = String(getTtsCacheLimit())
}

function preview() {
  playEdgeTts(props.sample, {
    volume: props.volume / 100,
    engine: { lengthScale: props.speed, voice: settingStore.ttsVoice },
  })
}
</script>

<template>
  <div>
    <SettingItem
      :mainTitle="title"
      desc="单词、翻译和例句使用所选音色，首次合成需联网，已缓存语音可直接播放。各项语速可在上方独立调节。"
    />
    <SettingItem title="试听" desc="按当前音色朗读示例,点击右侧喇叭">
      <div class="flex items-center gap-2 w-full">
        <span class="flex-1 text-sm" style="color: var(--color-sub-text)">{{ sample }}</span>
        <VolumeIcon :time="200" @click="preview" />
      </div>
    </SettingItem>
    <SettingItem title="音色" desc="支持英式英语、美式英语和中国大陆普通话，各组包含推荐和其他音色">
      <Select v-model="settingStore.ttsVoice" class="w-full!">
        <Option v-for="v in EDGE_TTS_VOICES" :key="v.value" :value="v.value" :label="v.label" :disabled="v.disabled" />
      </Select>
    </SettingItem>
    <SettingItem title="语音缓存上限" desc="默认 10000 条。满后删除播放次数最少的语音，次数相同时删除最久未播放的；调小上限后立即清理超出部分。">
      <input
        class="cache-limit-input"
        type="number"
        min="1"
        step="1"
        aria-label="语音缓存上限"
        :value="getTtsCacheLimit()"
        @change="updateCacheLimit"
      />
      <span>条</span>
    </SettingItem>
    <SettingItem v-if="showSpeed" title="翻译语速" desc="翻译朗读语速,与单词发音独立">
      <Slider v-model="settingStore.transSoundSpeed" :step="0.1" :min="0.5" :max="3" showText showValue />
    </SettingItem>
  </div>
</template>

<style scoped lang="scss">
.cache-limit-input {
  width: 8rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-input-border);
  border-radius: 4px;
  background: var(--color-input-bg);
  color: var(--color-input-color);
}
</style>