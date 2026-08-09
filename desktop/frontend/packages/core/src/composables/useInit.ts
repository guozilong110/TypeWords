import { APP_VERSION } from '../config/env'
import { debounce } from '../utils'
import { BaseState, SettingState, useBaseStore, useRuntimeStore, useSettingStore } from '../stores'
import { ensureHashGuardBeforeInit, useDataSyncPersistence } from './useDataSyncPersistence'
import { SyncDataType } from '../types'
import { SubscriptionCallbackMutation } from 'pinia'
import { Toast } from '@english-learner/base'

let unsub = null
let unsub2 = null
let saveErrorToastAt = 0 // 保存失败提示节流:一段时间内只弹一次,避免每次状态变更都弹

export function useInit() {
  const store = useBaseStore()
  const settingStore = useSettingStore()
  const runtimeStore = useRuntimeStore()
  const dataSync = useDataSyncPersistence()
  let initializing = false // 标记是否正在初始化
  let fetching = false
  let fetching2 = false

  // 主落盘链路失败兜底:静默丢进度最危险,提示用户(30 秒内只提示一次)
  function notifySaveError(err: unknown) {
    console.error('学习数据保存失败', err)
    const now = Date.now()
    if (now - saveErrorToastAt > 30000) {
      saveErrorToastAt = now
      Toast.error('学习数据保存失败,请检查磁盘空间')
    }
  }

  //init 有可能重复执行，因为从老网站导了数据之后需要 init
  async function init() {
    if (initializing) return
    initializing = true

    //先清理副作用，避免重复监听
    unsub?.()
    unsub2?.()

    await ensureHashGuardBeforeInit()
    let dictData = await store.init()
    let settingData = await settingStore.init()
    settingStore.load = true
    store.load = true
    initializing = false // 初始化完成，允许保存数据

    //用 $subscribe 替代 watch
    unsub = store.$subscribe(
      debounce(async (mutation, data: BaseState) => {
        if (fetching || runtimeStore.globalLoading) return
        if (data._ignoreWatch) {
          data._ignoreWatch = false
          return
        }
        if (mutation.type === 'direct' && mutation.events?.key === '_ignoreWatch') {
          return
        }
        fetching = true
        try {
          await dataSync.saveDictState(data)
        } catch (e) {
          notifySaveError(e)
        } finally {
          fetching = false
        }
      }, 1000)
    )

    unsub2 = settingStore.$subscribe(
      debounce(async (mutation: SubscriptionCallbackMutation<SettingState>, data: SettingState) => {
        if (fetching2 || runtimeStore.globalLoading) return
        if (data._ignoreWatch) {
          data._ignoreWatch = false
          return
        }
        if (mutation.type === 'direct' && mutation.events?.key === '_ignoreWatch') {
          return
        }
        fetching2 = true
        try {
          await dataSync.saveLocalAndSync(SyncDataType.setting, data)
        } catch (e) {
          notifySaveError(e)
        } finally {
          fetching2 = false
        }
      }, 1000)
    )

    runtimeStore.isNew = APP_VERSION.version > Number(settingStore.webAppVersion)
  }

  return init
}
