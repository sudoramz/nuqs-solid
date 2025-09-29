import { debug } from "../debug";
import { createEmitter, type Emitter } from "../emitter";
import type { Query } from "../search-params";
import { timeout } from "../timeout";
import { withResolvers, type Resolvers } from "../with-resolvers";
import {
  getSearchParamsSnapshotFromLocation,
  globalThrottleQueue,
  ThrottledQueue,
  type UpdateQueueAdapterContext,
  type UpdateQueuePushArgs
} from './throttle'
import { createSyncExternalStores } from "./create-sync-external-stores";

/**
 * A promise queue for debounced async work.
 */
export class DebouncedPromiseQueue<ValueType, OutputType> {
  callback: (value: ValueType) => Promise<OutputType>
  resolvers: Resolvers<OutputType> = withResolvers<OutputType>()
  controller: AbortController = new AbortController()
  queuedValue: ValueType | undefined = undefined

  constructor(callback: (value: ValueType) => Promise<OutputType>) {
    this.callback = callback
  }

  abort(): void {
    this.controller.abort()
    this.queuedValue = undefined
  }

  push(value: ValueType, timeMs: number): Promise<OutputType> {
    this.queuedValue = value
    this.controller.abort()
    this.controller = new AbortController()
    timeout(
      () => {
        const outputResolvers = this.resolvers
        try {
          debug('[nuqs dq] Flushing debounce queue', value)
          const callbackPromise = this.callback(value)
          debug('[nuqs dq] Reset debounce queue %O', this.queuedValue)
          this.queuedValue = undefined
          this.resolvers = withResolvers<OutputType>()
          callbackPromise
            .then(output => outputResolvers.resolve(output))
            .catch(error => outputResolvers.reject(error))
        } catch (error) {
          this.queuedValue = undefined
          outputResolvers.reject(error)
        }
      },
      timeMs,
      this.controller.signal
    )
    return this.resolvers.promise
  }
}

// --

type DebouncedUpdateQueue = DebouncedPromiseQueue<
  Omit<UpdateQueuePushArgs, 'timeMs'>,
  URLSearchParams
>

/**
 * DebounceController manages debounced and throttled update queues for query state.
 */
export class DebounceController {
  throttleQueue: ThrottledQueue
  queues: Map<string, DebouncedUpdateQueue> = new Map()
  queuedQuerySync: Emitter<Record<string, undefined>> = createEmitter()

  constructor(throttleQueue: ThrottledQueue = new ThrottledQueue()) {
    this.throttleQueue = throttleQueue
  }

  /**
   * Returns a map of getter functions for each key.
   * Each function is a reactive SolidJS signal.
   * 
   * Usage:
   *   const queued = debounceController.createQueuedQueries(['foo', 'bar']);
   *   createEffect(() => { console.log(queued.foo()); });
   */
  createQueuedQueries(
    keys: string[]
  ): Readonly<Record<string, () => Query | null | undefined>> {
    return createSyncExternalStores(
      keys,
      (key, callback) => this.queuedQuerySync.on(key, callback),
      (key: string) => this.getQueuedQuery(key)
    )
  }

  /**
   * One-liner for direct access to a single queued query as a getter signal.
   * Usage: createEffect(() => { console.log(debounceController.getQueuedQuerySignal("foo")()); });
   */
  getQueuedQuerySignal(key: string): () => Query | null | undefined {
    return this.createQueuedQueries([key])[key]
  }

  push(
    update: Omit<UpdateQueuePushArgs, 'timeMs'>,
    timeMs: number,
    adapter: UpdateQueueAdapterContext
  ): Promise<URLSearchParams> {
    if (!Number.isFinite(timeMs)) {
      const getSnapshot =
        adapter.getSearchParamsSnapshot ?? getSearchParamsSnapshotFromLocation
      return Promise.resolve(getSnapshot())
    }
    const key = update.key
    if (!this.queues.has(key)) {
      debug('[nuqs dqc] Creating debounce queue for `%s`', key)
      const queue = new DebouncedPromiseQueue<
        Omit<UpdateQueuePushArgs, 'timeMs'>,
        URLSearchParams
      >(async update => {
        this.throttleQueue.push(update)
        return this.throttleQueue.flush(adapter).finally(() => {
          const queuedValue = this.queues.get(update.key)?.queuedValue
          if (queuedValue === undefined) {
            debug('[nuqs dqc] Cleaning up empty queue for `%s`', update.key)
            this.queues.delete(update.key)
          }
          this.queuedQuerySync.emit(update.key)
        })
      })
      this.queues.set(key, queue)
    }
    debug('[nuqs dqc] Enqueueing debounce update %O', update)
    const promise = this.queues.get(key)!.push(update, timeMs)
    this.queuedQuerySync.emit(key)
    return promise
  }

  abort(
    key: string
  ): (promise: Promise<URLSearchParams>) => Promise<URLSearchParams> {
    const queue = this.queues.get(key)
    if (!queue) {
      return passThrough => passThrough
    }
    debug(
      '[nuqs dqc] Aborting debounce queue %s=%s',
      key,
      queue.queuedValue?.query
    )
    this.queues.delete(key)
    queue.abort()
    this.queuedQuerySync.emit(key)
    return promise => {
      promise.then(queue.resolvers.resolve, queue.resolvers.reject)
      return promise
    }
  }

  abortAll(): void {
    for (const [key, queue] of this.queues.entries()) {
      debug(
        '[nuqs dqc] Aborting debounce queue %s=%s',
        key,
        queue.queuedValue?.query
      )
      queue.abort()
      queue.resolvers.resolve(new URLSearchParams())
      this.queuedQuerySync.emit(key)
    }
    this.queues.clear()
  }

  getQueuedQuery(key: string): Query | null | undefined {
    const debouncedQueued = this.queues.get(key)?.queuedValue?.query
    if (debouncedQueued !== undefined) {
      return debouncedQueued
    }
    return this.throttleQueue.getQueuedQuery(key)
  }
}

export const debounceController = new DebounceController(globalThrottleQueue)
