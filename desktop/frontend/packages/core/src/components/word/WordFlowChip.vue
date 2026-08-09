<script setup lang="ts">
import { computed, nextTick, onUnmounted, watch } from 'vue'
import { useSettingStore } from '../../stores/setting.ts'
import { getWordStatus, WORD_STATUS_INFO } from '../../hooks/wordStatus.ts'
import TranslationList from './TranslationList.vue'
import { Tooltip } from '@english-learner/base'
import type { Word } from '../../types'

/**
 * 词块子组件(WordFlowList 的列表项):状态/禁用用 computed 缓存。
 * 父级切词时仅 active 前后两个词块的 props 变化,其余词块 props 不变 → 跳过重渲染;
 * 原实现每次切词整个列表全量重算(500 词复习列表 = 1500 次 dayjs 构造)。
 */
const props = withDefaults(
  defineProps<{
    word: Word
    active?: boolean
    showWord?: boolean
    showTranslate?: boolean
    /** 父级 computed Set 镜像(excludeWords push/splice 时引用变化触发重算) */
    excludeSet?: Set<string>
    static?: boolean // 静态模式:不滚动跟随当前词
    isActive?: boolean // 面板可见(可见时才滚动跟随)
  }>(),
  {
    active: false,
    showWord: true,
    showTranslate: true,
    excludeSet: undefined,
    static: true,
    isActive: false,
  }
)

const emit = defineEmits<{ click: [] }>()
const settingStore = useSettingStore()
const rootRef = $ref<HTMLElement>()
let scrollTimer: ReturnType<typeof setTimeout> | null = null

// 状态只算一次(原实现模板里调用 3 次:Tooltip 2 次 + 状态点 1 次)
const status = computed(() => getWordStatus(props.word.word))
const statusInfo = computed(() => WORD_STATUS_INFO[status.value])
const disabled = computed(() => !!props.excludeSet?.has(props.word.word))

/** 当前词滚动到可视区(仅动态模式 + 面板可见时) */
function scrollToActive() {
  if (props.static || !settingStore.showPanel) return
  nextTick(() => {
    rootRef?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

watch(
  () => props.active,
  (n: boolean) => {
    if (n) scrollToActive()
  },
  { immediate: true }
)

watch(
  () => props.isActive,
  (n: boolean) => {
    // 只有当前词块响应面板重开(整表 N 个词块各自滚动会让列表跳到底部 + 500 次 smooth 卡顿)
    if (n && props.active) {
      scrollTimer = setTimeout(() => scrollToActive(), 300)
    }
  }
)

onUnmounted(() => {
  if (scrollTimer) clearTimeout(scrollTimer)
})
</script>

<template>
  <div ref="rootRef" class="word-chip" :class="{ active, disabled }" @click="emit('click')">
    <div class="chip-head">
      <Tooltip :title="`${statusInfo.label}：${statusInfo.desc}`">
        <span class="status-dot" :style="{ background: statusInfo.color }"></span>
      </Tooltip>
      <span class="chip-word" :class="!showWord && 'word-shadow'">{{ word.word }}</span>
    </div>
    <div class="chip-trans" v-if="showTranslate">
      <TranslationList :word="word" :compact="true" :pos-space="false" :showFull="showWord" :show-play="false" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.word-chip {
  // 词块撑满整行,无右侧空白
  width: 100%;
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--color-item-border);
  border-radius: 0.5rem;
  background: var(--color-third);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;

  // 单词行:状态点与单词垂直居中,长单词完整显示(允许换行,不截断)
  .chip-head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;

    .status-dot {
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .chip-word {
      font-size: 0.95rem;
      line-height: 1.3;
      word-break: break-word;
      color: var(--color-main-text);
    }
  }

  // 翻译:单行截断,词性淡化、释义为主色,层级清晰
  .chip-trans {
    font-size: 0.78rem;
    line-height: 1.4;
    min-width: 0;

    :deep(.trans-list.compact .pos) {
      color: var(--color-sub-text);
      opacity: 0.75;
    }

    :deep(.trans-text) {
      color: var(--color-translate-main);
    }
  }

  &.disabled {
    opacity: 0.5;
  }

  &.active {
    background: var(--color-fifth);
    border-color: var(--color-select-bg);
  }

  &:hover {
    border-color: var(--color-select-bg);
  }
}
</style>
