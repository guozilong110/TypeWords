<script setup lang="ts">
import useTheme from '@english-learner/core/hooks/theme.ts'
import { applyWordFont } from '@english-learner/core/hooks/font.ts'
import { useSettingStore } from '@english-learner/core/stores/setting.ts'
import { nextTick, onMounted, provide, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { useInit } from '@english-learner/core/composables/useInit.ts'
import WordCollectPopover from '@english-learner/core/components/word/WordCollectPopover.vue'
import SettingsDialog from '@english-learner/core/components/setting/SettingsDialog.vue'
import IntroDialog from '@english-learner/core/components/IntroDialog.vue'
import { useExport } from '@english-learner/core/hooks/export'
import { ensurePersistedCacheLoaded } from '@english-learner/core/hooks/preloadTts.ts'
import { Toast } from '@english-learner/base'
import { APP_NAME } from '@english-learner/core/config/env'

const router = useRouter()
const { setTheme } = useTheme()
const settingStore = useSettingStore()
const init = useInit()
let settingsDialogRef = $ref()
// 首次启动介绍浮窗(设置-帮助的「功能介绍」入口也复用它)
let introDialogRef = $ref()

/** 打开功能介绍浮窗(首次启动引导 / 设置-帮助入口共用);
    mode: onboarding = 首次启动精简引导,full = 帮助入口完整版(默认) */
function openIntro(mode: 'onboarding' | 'full' = 'full') {
  introDialogRef?.open?.(mode)
}
provide('openIntro', openIntro)

// 桌面版(Electron)才有自定义标题栏;浏览器预览无 window.desktop 则跳过
// (typeof 判断兼容 SSR 预渲染:Node 环境无 window,直接返回 false)
const isDesktop = $computed(() => typeof window !== 'undefined' && !!window.desktop)

// 自定义标题栏(2026-08-14):切换深浅色时同步系统窗口按钮配色
// 浅色主背景 #e6e8eb / 深色 #202124(与 main.scss --color-primary 一致)
// 判断依据直接用 settingStore.theme + 系统主题,不依赖 documentElement.className 的 DOM 更新时序
const TITLEBAR_COLORS = {
  light: { color: '#e6e8eb', symbolColor: '#5b5b5b' },
  dark: { color: '#202124', symbolColor: '#f9fafb' },
}
function resolveTheme() {
  const t = settingStore.theme
  if (t === 'dark') return 'dark'
  if (t === 'light') return 'light'
  // auto:跟随系统
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function syncTitleBarOverlay() {
  if (!window.desktop?.setTitleBarOverlay) return
  window.desktop.setTitleBarOverlay(TITLEBAR_COLORS[resolveTheme()])
}

// 全局打开设置浮窗(单词页按钮、移动端导航共用)
function openSettings() {
  settingsDialogRef?.open?.()
}
provide('openSettings', openSettings)

watch(
  () => settingStore.load,
  n => {
    if (!n) return
    setTheme(settingStore.theme)
    applyWordFont(settingStore.wordFont)
    // 窗口置顶:启动时应用已保存的开关状态
    if (settingStore.alwaysOnTop) window.desktop?.setAlwaysOnTop?.(true)
    // 标题栏按钮配色:启动时按已保存主题设置(此时 theme 可能未变,theme watch 不触发)
    syncTitleBarOverlay()
    // 首次启动:自动弹出精简引导浮窗(settingStore.first 默认 true,看完/开始后置 false 持久化)
    if (settingStore.first) {
      nextTick(() => introDialogRef?.open?.('onboarding'))
    }
  }
)

watch(
  () => settingStore.theme,
  n => {
    setTheme(n)
    // 深浅色切换时同步窗口按钮配色(直接按设置值计算,无需等 DOM class 更新)
    syncTitleBarOverlay()
  }
)

watch(
  () => settingStore.wordFont,
  n => {
    applyWordFont(n)
  }
)

watch(
  () => settingStore.alwaysOnTop,
  n => {
    window.desktop?.setAlwaysOnTop?.(!!n)
  }
)

const route = useRoute()

onMounted(() => {
  init()
  // 恢复跨会话朗读缓存(IndexedDB 里最近 400 条翻译音频,隔天复习零延迟)
  ensurePersistedCacheLoaded()
  // 全局暴露标题栏高度(JS 设置 html 根变量,Toast 等在 body 下的元素也能读取)
  document.documentElement.style.setProperty('--titlebar-height', isDesktop.value ? '40px' : '0px')
  // 标题栏按钮配色:兜底同步一次(load/theme watch 均已覆盖,此行为浏览器环境无 desktop 时安全跳过)
  syncTitleBarOverlay()
  // 跟随系统模式下,系统明暗变化时同步标题栏按钮配色(theme 值不变,watch 不触发)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settingStore.theme === 'auto') syncTitleBarOverlay()
  })

  // 网络/接口失败轻提示:Edge TTS 合成失败时提示一次(30 秒节流,避免连续失败刷屏)
  let lastTtsFailToast = 0
  window.addEventListener('edge-tts-fail', () => {
    const now = Date.now()
    if (now - lastTtsFailToast > 30000) {
      lastTtsFailToast = now
      Toast.warning('网络不可用,翻译朗读失败')
    }
  })

  // 退出自动备份:主进程在窗口关闭前发来请求,这里组装备份数据交给主进程写文件
  // (仅 Electron 桌面版;浏览器环境无 window.desktop 则跳过)
  ;(window as any).desktop?.onAutoBackupRequest?.(async () => {
    try {
      if (settingStore.autoBackup) {
        const { getExportedData } = useExport()
        const data = await getExportedData()
        ;(window as any).desktop?.saveBackup?.(JSON.stringify(data))
      }
    } catch (e) {
      console.error('自动备份失败:', e)
    } finally {
      ;(window as any).desktop?.backupDone?.()
    }
  })
})
</script>

<template>
  <div class="layout anim" :class="{ 'has-titlebar': isDesktop }">
    <!-- 自定义标题栏(2026-08-14):桌面版隐藏系统标题栏后的拖拽区,与主背景同色视觉融合;
         右上角为系统窗口控制按钮(titleBarOverlay),右侧留空避免遮挡 -->
    <div v-if="isDesktop" class="app-titlebar">
      <span class="titlebar-title">{{ APP_NAME }}</span>
    </div>

    <!-- 移动端顶部菜单栏 -->
    <div class="mobile-top-nav" :class="{ collapsed: settingStore.mobileNavCollapsed }">
      <div class="nav-items">
        <div class="nav-item" @click="router.push('/words')" :class="{ active: route.path?.includes('/words') }">
          <IconFluentTextUnderlineDouble20Regular />
          <span>{{ '单词' }}</span>
        </div>
        <div class="nav-item" @click="openSettings()">
          <IconFluentSettings20Regular />
          <span>{{ '设置' }}</span>
        </div>
      </div>
      <div class="nav-toggle" @click="settingStore.mobileNavCollapsed = !settingStore.mobileNavCollapsed">
        <IconFluentChevronDown20Filled v-if="!settingStore.mobileNavCollapsed" />
        <IconFluentChevronUp20Filled v-else />
      </div>
    </div>

    <div class="flex-1 z-1 relative main-content overflow-x-hidden">
      <!--      <slot></slot>-->
      <router-view></router-view>
    </div>
    <WordCollectPopover />
    <SettingsDialog ref="settingsDialogRef" />
    <IntroDialog ref="introDialogRef" />
  </div>
</template>

<style scoped lang="scss">
.layout {
  width: 100%;
  height: 100vh; // 固定视口高度(父级 html/body 无高度链,100% 会解析成内容高度导致整体溢出)
  box-sizing: border-box; // height 含 padding,标题栏让位不再额外溢出
  display: flex;
  flex-direction: column; // 顶部标题栏让位后,内容区独占剩余高度
  background: var(--color-primary);

  // 桌面版(Electron)有自定义标题栏时,内容整体下移让位 40px
  &.has-titlebar {
    padding-top: 40px;
    --titlebar-height: 40px;
  }
}

// 桌面版标题栏高度供各页 fixed 顶部元素(工具栏/词表面板等)精确让位
.layout:not(.has-titlebar) {
  --titlebar-height: 0px;
}

// 内容区:唯一滚动容器(滚动发生在标题栏下方,内容滚到顶也不会穿过 fixed 标题栏)
.main-content {
  flex: 1;
  min-height: 0; // flex 子项允许收缩,配合 overflow 使内部滚动生效
  overflow-y: auto;
  overflow-x: hidden;

  // 移动端时为主内容区域添加顶部内边距，避免被顶部菜单遮挡
  @media (max-width: 768px) {
    padding-top: 4rem;
  }
}

// 自定义标题栏(2026-08-14):桌面版固定顶部拖拽区,与主背景同色融合
.app-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px; // 与 main.js titleBarOverlay.height 一致
  z-index: 10001;
  display: flex;
  align-items: center;
  padding-left: 0.9rem;
  background: var(--color-primary);
  color: var(--color-sub-text);
  // 与主背景(.layout.anim)同速渐变:切主题时标题栏条与界面背景一起过渡,
  // 避免"标题栏条瞬间变色、主背景还在渐变"造成的视觉错位
  transition: background var(--anim-time), color var(--anim-time);
  // 整条可拖拽窗口;右侧系统按钮区由 titleBarOverlay 原生绘制,无需 no-drag
  -webkit-app-region: drag;
  user-select: none;
  // 左侧标题文字,低调不抢界面
  .titlebar-title {
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    opacity: 0.55;
  }
}

// 移动端顶部菜单栏
.mobile-top-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: var(--color-second);
  border-bottom: 1px solid var(--color-item-border);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  transition: all 0.3s ease;

  .nav-items {
    display: flex;
    justify-content: space-around;
    padding: 0.5rem 0;

    .nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.5rem;
      cursor: pointer;
      transition: all 0.2s;
      min-height: 44px;
      min-width: 44px;
      justify-content: center;
      position: relative;

      svg {
        font-size: 1.2rem;
        margin-bottom: 0.2rem;
        color: var(--color-main-text);
      }

      span {
        font-size: 0.7rem;
        color: var(--color-main-text);
        text-align: center;
      }

      &.active {
        svg,
        span {
          color: var(--color-select-bg);
        }
      }

      &:active {
        transform: scale(0.95);
      }
    }
  }

  .nav-toggle {
    position: absolute;
    bottom: -1.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-second);
    border: 1px solid var(--color-item-border);
    border-top: none;
    border-radius: 0 0 0.5rem 0.5rem;
    padding: 0.3rem 0.8rem;
    cursor: pointer;
    transition: all 0.3s;

    svg {
      font-size: 1rem;
      color: var(--color-main-text);
    }

    &:active {
      transform: translateX(-50%) scale(0.95);
    }
  }

  &.collapsed {
    transform: translateY(calc(-100% + 1.5rem));

    .nav-items {
      opacity: 0;
      pointer-events: none;
    }
  }
}

.main-content {
  // 移动端时为主内容区域添加顶部内边距，避免被顶部菜单遮挡
  @media (max-width: 768px) {
    padding-top: 4rem;
  }
}

// 桌面端隐藏移动端顶部菜单栏
@media (min-width: 769px) {
  .mobile-top-nav {
    display: none;
  }
}
</style>
