import {
  startTransition,
  createEffect,
  createSignal
} from 'solid-js'
import { debug } from '../../lib/debug'
import { createEmitter } from '../../lib/emitter'
import { setQueueResetMutex } from '../../lib/queues/reset'
import { globalThrottleQueue } from '../../lib/queues/throttle'
import { renderQueryString } from '../custom'
import { createAdapterProvider, type AdapterProvider } from './context'
import type { AdapterInterface, AdapterOptions } from './defs'
import { applyChange, filterSearchParams } from './key-isolation'
import {
  patchHistory as applyHistoryPatch,
  historyUpdateMarker
} from './patch-history'

// Abstract away types for the useNavigate hook from solid-router
type NavigateUrl = {
  hash?: string
  search?: string
}
type NavigateOptions = {
  replace?: boolean
  resolve?: boolean
  scroll?: boolean
  state?: unknown
}
type NavigateFn = (to: NavigateUrl, options: NavigateOptions) => void
type UseNavigate = () => NavigateFn
// type UseSearchParams = (initial: URLSearchParams) => [URLSearchParams, {}]

// --
