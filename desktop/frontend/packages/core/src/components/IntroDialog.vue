<script setup lang="ts">
// 内嵌版功能介绍页(2026-08-14):首次启动自动弹出 + 设置-帮助常驻入口
// 内容基于宣传落地页,适配软件内场景:去下载/开源CTA,加「开始学习」按钮;深浅色跟随主题变量
// 两种模式:onboarding = 首次启动精简引导(封面+玩法,一屏读完,按钮引导选词库);
//            full = 设置-帮助「功能介绍」完整版(全部板块)
import { defineAsyncComponent, ref } from 'vue'
import { useSettingStore } from '../stores/setting.ts'
import { useBaseStore } from '../stores/base.ts'
import { useNav } from '../utils'

const Dialog = defineAsyncComponent(() => import('@english-learner/base/Dialog'))

const modelValue = defineModel<boolean>({ default: false })

const settingStore = useSettingStore()
const baseStore = useBaseStore()
const { nav } = useNav()

const activeMode = ref<'onboarding' | 'full'>('full')

/** 外部打开(布局模板 ref 调用):与 SettingsDialog 同模式;mode 指定展示形态,默认完整版 */
function open(mode: 'onboarding' | 'full' = 'full') {
  activeMode.value = mode
  modelValue.value = true
}
defineExpose({ open })

/** 开始学习:关闭引导 + 落地,下次不再自动弹出 */
function startStudy() {
  settingStore.first = false
  modelValue.value = false
  // 首次引导场景:把用户带到下一步——全新用户去词库大厅选词库,已有学习词库的直接进练习页
  if (activeMode.value === 'onboarding') {
    const hasDict = baseStore.word.bookList?.some(d => d.words?.length) ?? false
    nav(hasDict ? '/words' : '/dict-list')
  }
}

/** 跳过:本次关闭,首次启动时下次打开仍会弹出 */
function skip() {
  modelValue.value = false
}

/** 常驻入口打开时(非首次引导):直接关闭即可 */
function close() {
  modelValue.value = false
}
</script>

<template>
  <Dialog
    v-model="modelValue"
    :header="false"
    :show-close="false"
    :close-on-click-bg="false"
    full-screen
    class="intro-dialog"
  >
    <div class="intro">
      <!-- 顶部导航条 -->
      <div class="intro-nav">
        <div class="intro-nav-inner">
          <span class="intro-logo">⌨ {{ activeMode === 'onboarding' ? '新手上路' : '功能介绍' }}</span>
          <button class="intro-skip" @click="close">{{ activeMode === 'onboarding' ? '✕ 跳过' : '✕ 关闭' }}</button>
        </div>
      </div>

      <div class="intro-scroll">
        <!-- ===== 封面 ===== -->
        <section class="intro-hero">
          <div class="intro-hero-inner">
            <div class="intro-hero-text">
              <span class="intro-badge">打字背单词桌面应用</span>
              <h1>把单词打进脑子</h1>
              <p class="intro-tagline">跟打 · 听写 · 自测 · 默写 —— 每一个字母都由你亲手敲出,手脑并用,记得更牢。</p>
              <div class="intro-hero-btns">
                <button class="intro-btn-primary" @click="startStudy">🚀 开始学习</button>
                <button v-if="activeMode === 'full'" class="intro-btn-ghost" @click="skip">稍后再说</button>
              </div>
            </div>
            <div class="intro-hero-shot">
              <div class="intro-shot-bar"><i></i><i></i><i></i></div>
              <img src="/imgs/home.png" alt="EnglishLearner 主界面" />
            </div>
          </div>
        </section>

        <!-- ===== 数据亮点 ===== -->
        <section class="intro-stats">
          <div class="intro-stat"><span class="intro-stat-num">33</span><span class="intro-stat-label">内置词库</span></div>
          <div class="intro-stat"><span class="intro-stat-num">84.9万</span><span class="intro-stat-label">查词覆盖</span></div>
          <div class="intro-stat"><span class="intro-stat-num hot">0</span><span class="intro-stat-label">广告 · 账号 · 会员</span></div>
          <div class="intro-stat"><span class="intro-stat-num hot">GPL-3.0</span><span class="intro-stat-label">完全开源</span></div>
        </section>

        <!-- ===== 核心玩法 ===== -->
        <section class="intro-section">
          <span class="intro-kicker">⌨️ 核心玩法</span>
          <h2 class="intro-title">每个字母都亲手打出来</h2>
          <p class="intro-sub">打字是主动回忆,不是被动浏览。拼写、词形、发音同步建立记忆,背过的词真正会用。</p>
          <div class="intro-modes">
            <div class="intro-mode m-follow">
              <div class="intro-mode-emoji">👀</div>
              <div class="intro-mode-title">跟打</div>
              <div class="intro-mode-desc">看着单词逐字母敲,建立手型记忆;打完自动进入例句跟打</div>
            </div>
            <div class="intro-mode m-listen">
              <div class="intro-mode-emoji">🎧</div>
              <div class="intro-mode-title">听写</div>
              <div class="intro-mode-desc">只听发音拼出单词,耳朵和手指一起练,听力拼写双提升</div>
            </div>
            <div class="intro-mode m-test">
              <div class="intro-mode-emoji">✅</div>
              <div class="intro-mode-title">自测</div>
              <div class="intro-mode-desc">快速判断认识与否,查漏补缺;单词测验模式四选一作答</div>
            </div>
            <div class="intro-mode m-write">
              <div class="intro-mode-emoji">✍️</div>
              <div class="intro-mode-title">默写</div>
              <div class="intro-mode-desc">看中文打英文,检验真实掌握度;配合复习队列到期自动安排</div>
            </div>
          </div>
        </section>

        <!-- ===== 界面预览(仅完整版) ===== -->
        <section v-if="activeMode === 'full'" class="intro-section intro-alt">
          <span class="intro-kicker">🖥️ 界面预览</span>
          <h2 class="intro-title">真实界面,所见即所得</h2>
          <p class="intro-sub">深色 / 浅色主题随心切换,界面一体化无广告打扰,专注当下这个词。</p>
          <div class="intro-showcase">
            <figure class="intro-shot-card">
              <img src="/imgs/home-dark.png" alt="深色主题主界面" />
              <figcaption>深色主题 · 主页统计与查词</figcaption>
            </figure>
            <figure class="intro-shot-card">
              <img src="/imgs/practice.png" alt="打字练习界面" />
              <figcaption>打字练习 · 跟打 / 例句 / 词表</figcaption>
            </figure>
            <figure class="intro-shot-card">
              <img src="/imgs/dict-list.png" alt="词库列表" />
              <figcaption>词库大厅 · 33 个词库开箱即用</figcaption>
            </figure>
            <figure class="intro-shot-card">
              <img src="/imgs/settings.png" alt="设置界面" />
              <figcaption>设置浮窗 · 9 大分类,窗口可拖拽</figcaption>
            </figure>
          </div>
        </section>

        <!-- ===== 记忆曲线(仅完整版) ===== -->
        <section v-if="activeMode === 'full'" class="intro-section">
          <span class="intro-kicker">🧠 记忆曲线</span>
          <h2 class="intro-title">背过的词,不会白背</h2>
          <p class="intro-sub">FSRS 智能遗忘曲线算法——根据每一次答题表现,自动计算每个词的最佳复习时间。</p>
          <div class="intro-curve-wrap">
            <div class="intro-curve-card">
              <svg viewBox="0 0 380 150" xmlns="http://www.w3.org/2000/svg">
                <line x1="20" y1="130" x2="360" y2="130" stroke="var(--color-line)" stroke-width="1.5" stroke-dasharray="4 6"/>
                <line x1="20" y1="95" x2="360" y2="95" stroke="var(--color-line)" stroke-width="1.5" stroke-dasharray="4 6"/>
                <line x1="20" y1="60" x2="360" y2="60" stroke="var(--color-line)" stroke-width="1.5" stroke-dasharray="4 6"/>
                <line x1="20" y1="25" x2="360" y2="25" stroke="var(--color-line)" stroke-width="1.5" stroke-dasharray="4 6"/>
                <path class="intro-curve-path" d="M20 25 C 60 25, 75 55, 95 78 C 115 101, 140 108, 165 105 C 190 102, 205 70, 225 55 C 245 40, 265 35, 290 30 C 315 25, 340 22, 360 18"/>
                <g>
                  <circle cx="20" cy="25" r="6" fill="var(--color-warning)" stroke="var(--color-card-bg)" stroke-width="2.5"/>
                  <circle cx="140" cy="108" r="6" fill="var(--color-error)" stroke="var(--color-card-bg)" stroke-width="2.5"/>
                  <circle cx="225" cy="55" r="6" fill="var(--color-info)" stroke="var(--color-card-bg)" stroke-width="2.5"/>
                  <circle cx="360" cy="18" r="7" fill="var(--color-success)" stroke="var(--color-card-bg)" stroke-width="2.5"/>
                </g>
                <text x="14" y="13" font-size="10" fill="var(--color-sub-text)">学</text>
                <text x="126" y="126" font-size="10" fill="var(--color-error)">遗忘</text>
                <text x="205" y="46" font-size="10" fill="var(--color-info)">复习</text>
                <text x="330" y="12" font-size="10" fill="var(--color-success)">稳固</text>
              </svg>
              <div class="intro-curve-note">
                <span class="intro-curve-badge">FSRS</span>
                <span>每次答题自动重新计算复习间隔 —— 记得越牢,间隔越长</span>
              </div>
            </div>
            <div class="intro-curve-list">
              <div class="intro-curve-item"><span class="intro-ci-icon">📅</span><div><b>复习计划,一目了然</b><p>未来 7 天每天待复习的单词提前预览,可提前或按时复习</p></div></div>
              <div class="intro-curve-item"><span class="intro-ci-icon">🔄</span><div><b>自动调度,无需操心</b><p>到期单词自动进入复习队列,新词与复习词按比例搭配</p></div></div>
              <div class="intro-curve-item"><span class="intro-ci-icon">📊</span><div><b>学习记录,进步可见</b><p>每日时长、新学/复习词数、连续天数、累计时长全部记录</p></div></div>
            </div>
          </div>
        </section>

        <!-- ===== 词库(仅完整版) ===== -->
        <section v-if="activeMode === 'full'" class="intro-section intro-alt">
          <span class="intro-kicker">📚 词库</span>
          <h2 class="intro-title">33 个词库,开箱即用</h2>
          <p class="intro-sub">从初中到考研一条龙,全部随安装包内置,断网也能学。另有 84.9 万词查词索引,生词随时查。</p>
          <div class="intro-dicts">
            <span class="intro-dict-tag">中考核心</span>
            <span class="intro-dict-tag">高考 3500</span>
            <span class="intro-dict-tag">高考真题高频</span>
            <span class="intro-dict-tag">人教版初中 7-9</span>
            <span class="intro-dict-tag">人教版高中必修</span>
            <span class="intro-dict-tag">大学四级 CET-4</span>
            <span class="intro-dict-tag">大学六级 CET-6</span>
            <span class="intro-dict-tag">考研 926</span>
            <span class="intro-dict-tag">专升本 3000</span>
            <span class="intro-dict-tag">专四专八</span>
            <span class="intro-dict-tag">雅思 IELTS</span>
            <span class="intro-dict-tag">托福 TOEFL</span>
            <span class="intro-dict-tag">新概念 1-4</span>
            <span class="intro-dict-tag">牛津 3000</span>
            <span class="intro-dict-tag more">+ 更多</span>
          </div>
          <p class="intro-dict-note">📖 词库数据来自网络收集,仅供学习研究;内置查词索引覆盖 84.9 万词(含 ECDICT,按 MIT 协议)</p>
        </section>

        <!-- ===== 细节特色(仅完整版) ===== -->
        <section v-if="activeMode === 'full'" class="intro-section">
          <span class="intro-kicker">💎 细节</span>
          <h2 class="intro-title">专注学习,不被打扰</h2>
          <div class="intro-features">
            <div class="intro-feature"><span class="intro-f-icon">🚫</span><b>无广告无账号</b><p>零商业化打扰,打开就能背</p></div>
            <div class="intro-feature"><span class="intro-f-icon">🔒</span><b>纯本地数据</b><p>数据全存本机,断网可学,隐私不离开电脑</p></div>
            <div class="intro-feature"><span class="intro-f-icon">💾</span><b>自动备份</b><p>退出自动备份到「文档」,保留 7 份,重装不丢</p></div>
            <div class="intro-feature"><span class="intro-f-icon">🔊</span><b>双语语音</b><p>单词发音(英/美音)+ 中文朗读(6 音色,需联网),播放前预加载,几乎零延迟</p></div>
            <div class="intro-feature"><span class="intro-f-icon">✏️</span><b>MiSans 字体</b><p>内置 10 个字重,全局一键切换,字符间距可调</p></div>
            <div class="intro-feature"><span class="intro-f-icon">🌗</span><b>深色主题</b><p>跟随系统 / 浅色 / 深色,深夜背词不刺眼</p></div>
            <div class="intro-feature"><span class="intro-f-icon">⌨️</span><b>按键音效</b><p>13 种机械键盘轴体音效,敲出学习节奏感</p></div>
            <div class="intro-feature"><span class="intro-f-icon">🎛️</span><b>快捷键自定义</b><p>全部快捷键可改,手势记进肌肉</p></div>
            <div class="intro-feature"><span class="intro-f-icon">📤</span><b>导入导出</b><p>备份迁移 + 导入自定义词库(xlsx/官方文件)</p></div>
          </div>
        </section>

        <!-- ===== 收尾 CTA(仅完整版;引导版封面按钮已够) ===== -->
        <section v-if="activeMode === 'full'" class="intro-footer-cta">
          <div class="intro-cta-card">
            <div class="intro-cta-title">敲下你的第一个单词</div>
            <div class="intro-cta-sub">选一本合适的词库,从今天开始,每天进步一点点。</div>
            <button class="intro-btn-primary big" @click="startStudy">🚀 开始学习</button>
          </div>
        </section>
      </div>
    </div>
  </Dialog>
</template>

<style scoped lang="scss">
// 全屏介绍:主题跟随 CSS 变量(深浅色自动适配)
.intro {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-primary);
  color: var(--color-main-text);
}

// 顶部导航条
.intro-nav {
  flex-shrink: 0;
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 1.4rem;
  background: var(--color-second);
  border-bottom: 1px solid var(--color-item-border);
  z-index: 10;
}
.intro-nav-inner {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.intro-logo {
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--color-main-text);
}
.intro-skip {
  background: none;
  border: 1px solid var(--color-item-border);
  color: var(--color-sub-text);
  font-size: 0.8rem;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.2s ease;
  &:hover {
    border-color: var(--color-select-bg);
    color: var(--color-select-bg);
  }
}

// 滚动容器
.intro-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

// ===== 封面 =====
.intro-hero {
  padding: 3.2rem 1.4rem 2.6rem;
  background:
    radial-gradient(45% 60% at 85% 10%, color-mix(in srgb, var(--color-info) 14%, transparent) 0%, transparent 60%),
    radial-gradient(40% 50% at 10% 30%, color-mix(in srgb, var(--color-success) 12%, transparent) 0%, transparent 60%);
}
.intro-hero-inner {
  max-width: 1080px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 3rem;
  align-items: center;
}
.intro-badge {
  display: inline-block;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-info);
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-info) 35%, transparent);
  padding: 0.35rem 0.9rem;
  border-radius: 999px;
  margin-bottom: 1.1rem;
}
.intro-hero h1 {
  font-size: clamp(2rem, 4.5vw, 2.8rem);
  line-height: 1.25;
  font-weight: 900;
  letter-spacing: 1px;
}
.intro-tagline {
  margin-top: 0.9rem;
  font-size: 0.98rem;
  line-height: 1.9;
  color: var(--color-sub-text);
}
.intro-hero-btns {
  margin-top: 1.6rem;
  display: flex;
  gap: 0.9rem;
  flex-wrap: wrap;
}
.intro-btn-primary {
  border: none;
  cursor: pointer;
  background: var(--color-select-bg);
  color: #fff;
  font-size: 0.98rem;
  font-weight: 700;
  padding: 0.75rem 2rem;
  border-radius: 999px;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--color-select-bg) 45%, transparent);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  &:hover { transform: translateY(-2px); }
  &.big { padding: 0.9rem 2.6rem; font-size: 1.05rem; }
}
.intro-btn-ghost {
  border: 1.5px solid var(--color-item-border);
  background: var(--color-card-bg);
  color: var(--color-main-text);
  font-size: 0.95rem;
  font-weight: 500;
  padding: 0.75rem 1.6rem;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.2s ease;
  &:hover { border-color: var(--color-select-bg); color: var(--color-select-bg); }
}
.intro-hero-shot {
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--color-item-border);
  box-shadow: var(--shadow-card-hover);
  background: var(--color-card-bg);
}
.intro-shot-bar {
  display: flex;
  gap: 6px;
  padding: 0.7rem 1rem;
  background: var(--color-second);
  border-bottom: 1px solid var(--color-item-border);
  i {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--color-third);
  }
}
.intro-hero-shot img, .intro-shot-card img { display: block; width: 100%; height: auto; }

// ===== 数据条 =====
.intro-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: var(--color-second);
  border-top: 1px solid var(--color-item-border);
  border-bottom: 1px solid var(--color-item-border);
}
.intro-stat {
  padding: 1.6rem 1rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  border-right: 1px solid var(--color-item-border);
  &:last-child { border-right: none; }
}
.intro-stat-num {
  font-weight: 900;
  font-size: 1.6rem;
  color: var(--color-info);
  &.hot { color: var(--color-warning); }
}
.intro-stat-label {
  font-size: 0.78rem;
  color: var(--color-sub-text);
}

// ===== 通用 section =====
.intro-section {
  padding: 3rem 1.4rem;
  max-width: 1080px;
  margin: 0 auto;
  width: 100%;
}
.intro-alt { max-width: none; background: var(--color-second); border-top: 1px solid var(--color-item-border); border-bottom: 1px solid var(--color-item-border); }
.intro-alt > * { max-width: 1080px; margin-left: auto; margin-right: auto; }
.intro-kicker {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--color-info);
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-info) 35%, transparent);
  padding: 0.32rem 0.9rem;
  border-radius: 999px;
  margin-bottom: 0.9rem;
}
.intro-title {
  font-size: clamp(1.35rem, 2.6vw, 1.8rem);
  font-weight: 900;
  letter-spacing: 0.5px;
}
.intro-sub {
  margin-top: 0.6rem;
  font-size: 0.92rem;
  line-height: 1.9;
  color: var(--color-sub-text);
  max-width: 640px;
}

// ===== 玩法卡片 =====
.intro-modes {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-top: 1.8rem;
}
.intro-mode {
  background: var(--color-card-bg);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-item-border);
  box-shadow: var(--shadow-card);
  padding: 1.4rem 1.2rem 1.2rem;
  position: relative;
  overflow: hidden;
  transition: transform 0.25s ease;
  &:hover { transform: translateY(-4px); }
  &::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; }
  &.m-follow::before { background: var(--color-info); }
  &.m-listen::before { background: var(--color-success); }
  &.m-test::before { background: var(--color-warning); }
  &.m-write::before { background: var(--color-error); }
}
.intro-mode-emoji {
  width: 2.7rem; height: 2.7rem;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.35rem;
  background: var(--color-second);
}
.intro-mode-title { font-weight: 900; font-size: 1.05rem; margin-top: 0.8rem; }
.intro-mode-desc { margin-top: 0.35rem; font-size: 0.8rem; line-height: 1.75; color: var(--color-sub-text); }

// ===== 截图展示 =====
.intro-showcase {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.2rem;
  margin-top: 1.8rem;
}
.intro-shot-card {
  margin: 0;
  background: var(--color-card-bg);
  border-radius: var(--radius-card);
  overflow: hidden;
  border: 1px solid var(--color-item-border);
  box-shadow: var(--shadow-card);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  &:hover { transform: translateY(-4px); box-shadow: var(--shadow-card-hover); }
  figcaption {
    padding: 0.75rem 1rem;
    font-size: 0.82rem;
    font-weight: 700;
    border-top: 1px solid var(--color-item-border);
    background: var(--color-second);
    color: var(--color-main-text);
  }
}

// ===== 记忆曲线 =====
.intro-curve-wrap {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  align-items: center;
  margin-top: 1.8rem;
}
.intro-curve-card {
  background: var(--color-card-bg);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-item-border);
  box-shadow: var(--shadow-card);
  padding: 1.6rem 1.4rem 1.3rem;
  svg { width: 100%; display: block; }
}
.intro-curve-path {
  fill: none;
  stroke: var(--color-success);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-dasharray: 700;
  stroke-dashoffset: 700;
  animation: introDraw 2.2s ease-out forwards;
}
@keyframes introDraw { to { stroke-dashoffset: 0; } }
.intro-curve-note {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-top: 0.9rem;
  font-size: 0.8rem;
  color: var(--color-sub-text);
  line-height: 1.7;
}
.intro-curve-badge {
  flex-shrink: 0;
  background: var(--color-success);
  color: #fff;
  font-weight: 900;
  font-size: 0.72rem;
  padding: 0.2rem 0.7rem;
  border-radius: 999px;
}
.intro-curve-list { display: flex; flex-direction: column; gap: 0.9rem; }
.intro-curve-item {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
  background: var(--color-card-bg);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-item-border);
  box-shadow: var(--shadow-card);
  padding: 1rem 1.1rem;
  b { font-size: 0.9rem; }
  p { margin-top: 0.25rem; font-size: 0.78rem; line-height: 1.7; color: var(--color-sub-text); }
}
.intro-ci-icon {
  width: 2.3rem; height: 2.3rem;
  border-radius: 10px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.05rem;
  background: var(--color-second);
}

// ===== 词库 =====
.intro-dicts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1.6rem;
  max-width: 1080px;
}
.intro-dict-tag {
  font-size: 0.82rem;
  font-weight: 700;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  background: var(--color-card-bg);
  border: 1.5px solid var(--color-item-border);
  box-shadow: var(--shadow-card);
  color: var(--color-main-text);
  transition: transform 0.2s ease;
  &:hover { transform: translateY(-2px); }
  &.more { background: var(--color-warning); border-color: var(--color-warning); color: #fff; font-weight: 900; }
}
.intro-dict-note {
  margin-top: 1.2rem;
  font-size: 0.78rem;
  color: var(--color-sub-text);
  max-width: 1080px;
}

// ===== 细节特色 =====
.intro-features {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-top: 1.8rem;
}
.intro-feature {
  background: var(--color-card-bg);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-item-border);
  box-shadow: var(--shadow-card);
  padding: 1.3rem 1.2rem;
  b { font-size: 0.92rem; }
  p { margin-top: 0.3rem; font-size: 0.78rem; line-height: 1.7; color: var(--color-sub-text); }
}
.intro-f-icon {
  width: 2.4rem; height: 2.4rem;
  border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.1rem;
  background: var(--color-second);
  margin-bottom: 0.7rem;
}

// ===== 收尾 CTA =====
.intro-footer-cta {
  padding: 2.6rem 1.4rem 3.4rem;
}
.intro-cta-card {
  max-width: 1080px;
  margin: 0 auto;
  background: var(--color-second);
  border: 1px solid var(--color-item-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 2.6rem 2rem;
  text-align: center;
}
.intro-cta-title { font-size: 1.5rem; font-weight: 900; }
.intro-cta-sub { margin-top: 0.6rem; font-size: 0.9rem; color: var(--color-sub-text); }
.intro-cta-card .intro-btn-primary { margin-top: 1.4rem; }

// ===== 响应式 =====
@media (max-width: 900px) {
  .intro-hero-inner { grid-template-columns: 1fr; }
  .intro-modes { grid-template-columns: repeat(2, 1fr); }
  .intro-curve-wrap { grid-template-columns: 1fr; }
  .intro-showcase { grid-template-columns: 1fr; }
  .intro-features { grid-template-columns: repeat(2, 1fr); }
  .intro-stats { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 560px) {
  .intro-modes { grid-template-columns: 1fr; }
  .intro-features { grid-template-columns: 1fr; }
}
</style>
