<script setup lang="ts">
import { lookupWord } from '../../hooks/useWordLookup.ts'
import { usePlayWordAudio } from '../../hooks/sound.ts'
import { onMounted, watch } from 'vue'
import { prefetchWordAudio } from '../../hooks/preloadTts'
import { useSettingStore } from '../../stores/setting'

const props = defineProps<{
  word: string
}>()

const playWordAudio = usePlayWordAudio()
const settingStore = useSettingStore()
const preloadWord = () => { void prefetchWordAudio(props.word, settingStore.ttsVoice) }
onMounted(preloadWord)
watch([() => props.word, () => settingStore.ttsVoice], preloadWord)

function onClick(e: MouseEvent, word: string) {
  lookupWord(e, word, playWordAudio)
}
</script>

<template>
  <span class="clickable-word" @click="onClick($event, word)">{{ word }}</span>
</template>

<style scoped lang="scss">
.clickable-word {
  cursor: pointer;
  border-radius: 0.15rem;
  transition: background-color 0.15s ease;

  &:hover {
    @apply bg-green/70! color-black;
  }
}
</style>
