<script setup lang="ts">
import { computed } from 'vue'
import WordFlowChip from './WordFlowChip.vue'
import type { Word } from '../../types'

/**
 * 横向流式词表(练习页右侧面板):词块从左到右流式排列,超宽换行。
 * 词块 = 掌握状态点 + 单词 + 常驻翻译(单行截断),点击跳转,当前词高亮。
 * 每个词块是独立子组件(WordFlowChip):状态/禁用 computed 缓存,
 * 切词时仅 active 前后两个词块重渲染,不再整个列表全量重算。
 */
const props = withDefaults(
  defineProps<{
    list?: Word[]
    activeIndex?: number
    showWord?: boolean // 默写遮挡:false 时单词模糊
    showTranslate?: boolean
    excludeWords?: string[]
    isActive?: boolean // 面板是否可见(可见时才滚动跟随)
    static?: boolean // 静态模式:不滚动跟随当前词
  }>(),
  {
    list: [],
    activeIndex: -1,
    showWord: true,
    showTranslate: true,
    excludeWords: [],
    isActive: false,
    static: true,
  }
)

const emit = defineEmits<{ click: [index: number] }>()

// 排除词 Set 镜像:computed 追踪数组内容(push/splice 触发重建,引用变化通知子组件重算禁用态)
const excludeWordsSet = computed(() => new Set(props.excludeWords))
</script>

<template>
  <div class="word-flow">
    <WordFlowChip
      v-for="(item, index) in list"
      :key="index"
      :word="item"
      :active="index === activeIndex"
      :show-word="showWord"
      :show-translate="showTranslate"
      :exclude-set="excludeWordsSet"
      :is-active="isActive"
      :static="static"
      @click="emit('click', index)"
    />
  </div>
</template>

<style scoped lang="scss">
.word-flow {
  // 始终单列:纵向排列,窗口大小不影响列数(面板宽度响应式变化不再导致列数跳变)
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem 0.6rem;
  height: 100%;
  overflow: auto;
}
</style>
