import {
  type Accessor,
  createUniqueId,
  createSignal,
  createMemo,
  createEffect,
  onCleanup
} from "solid-js"
import {
  useAdapter,
  useAdapterDefaultOptions,
  useAdapterProcessUrlSearchParams
} from "./adapters/context"
import type { Options, Nullable, UrlKeys } from "./defs"
import { compareQuery } from "./lib/compare"
import { debug } from "./lib/debug"
import { error } from "./lib/errors"
import { debounceController } from "./lib/queues/debounce"
import {
  globalThrottleQueue,
  type UpdateQueuePushArgs
} from "./lib/queues/throttle"
import { safeParse } from "./lib/safe-parse"
import { isAbsentFromUrl, type Query } from "./lib/search-params"
import { emitter, type CrossHookSyncPayload } from "./lib/sync"
import type { GenericParser } from "./parsers"
import { defaultRateLimit } from "./lib/queues/rate-limiting"

type KeyMapValue<Type> = GenericParser<Type> &
  Options & {
    defaultValue?: Type
  }

export type CreateQueryStatesKeysMap<Map = any> = {
  [Key in keyof Map]: KeyMapValue<Map[Key]>
} & {}

export type CreateQueryStatesOptions<KeyMap extends CreateQueryStatesKeysMap> =
  Options & {
    urlKeys: UrlKeys<KeyMap>
  }

export type Values<T extends CreateQueryStatesKeysMap> = {
  [K in keyof T]: T[K]['defaultValue'] extends NonNullable<
    ReturnType<T[K]['parse']>
  >
  ? NonNullable<ReturnType<T[K]['parse']>>
  : ReturnType<T[K]['parse']> | null
}

type NullableValues<T extends CreateQueryStatesKeysMap> = Nullable<Values<T>>

type UpdaterFn<T extends CreateQueryStatesKeysMap> = (
  old: Values<T>
) => Partial<Nullable<Values<T>>> | null

export type SetValues<T extends CreateQueryStatesKeysMap> = (
  values: Partial<Nullable<Values<T>>> | UpdaterFn<T> | null,
  options?: Options
) => Promise<URLSearchParams>

export type CreateQueryStatesReturn<T extends CreateQueryStatesKeysMap> = [
  Accessor<Values<T>>,
  SetValues<T>
]

function unwrapSignals<T>(
  getters: Readonly<Record<string, () => T>>
): Record<string, T> {
  const result: Record<string, T> = {}
  for (const key in getters) {
    result[key] = getters[key]()
  }
  return result
}

// The original documentation had this hoisted outside the function scope
// because of React's useEffect, but we well also do so in solid for consistency
// and guarantee of a stable reference even though with solid, the hook function only
// runs once
const defaultUrlKeys = {}

/**
 * Synchronise multiple query string arguments to a reactive signal in SolidJS.
 *
 * @param keyMap - An object describing the keys to synchronise and how to
 * serialise and parse them.
 * @param options - Optional history mode, shallow routing and scroll restoration options.
 */
export function createQueryStates<KeyMap extends CreateQueryStatesKeysMap>(
  keyMap: KeyMap,
  options: Partial<CreateQueryStatesOptions<KeyMap>>
): CreateQueryStatesReturn<KeyMap> {
  const hookId = createUniqueId()
  const defaultOptions = useAdapterDefaultOptions()
  const processUrlSearchParams = useAdapterProcessUrlSearchParams()

  const {
    history = 'replace',
    scroll = defaultOptions?.scroll ?? false,
    shallow = defaultOptions?.shallow ?? true,
    limitUrlUpdates = defaultOptions?.limitUrlUpdates,
    clearOnDefault = defaultOptions?.clearOnDefault ?? true,
    throttleMs = defaultRateLimit.timeMs,
    startTransition,
    urlKeys = defaultUrlKeys as UrlKeys<KeyMap>
  } = options

  type V = NullableValues<KeyMap>
  const stateKeys = Object.keys(keyMap).join(',')
  const resolvedUrlKeys = createMemo(() =>
    Object.fromEntries(
      Object.keys(keyMap).map(key => [key, urlKeys[key] ?? key])
    )
  )
  const adapter = useAdapter(Object.values(resolvedUrlKeys()))
  const initialSearchParams = adapter.searchParams

  let queryRef: Record<string, Query | null> = {}
  let stateRef: V

  const defaultValues = createMemo(() =>
    Object.fromEntries(
      Object.keys(keyMap).map(key => [key, keyMap[key]!.defaultValue ?? null])
    ) as Values<KeyMap>
  )

  const queuedQueries = debounceController.createQueuedQueries(
    Object.values(resolvedUrlKeys())
  )
  const [internalState, setInternalState] = createSignal<V>(
    (() => {
      const source = initialSearchParams ?? new URLSearchParams();
      return parseMap(keyMap, urlKeys, source, unwrapSignals(queuedQueries)).state;
    })()
  );

  stateRef = internalState()
  debug(
    '[nuq+ %s `%s`] render - state: %O, iSP: %s',
    hookId,
    stateKeys,
    internalState,
    initialSearchParams
  )

  if (
    Object.keys(queryRef).join('&') !==
    Object.values(resolvedUrlKeys()).join('&')
  ) {
    const { state, hasChanged } = parseMap(
      keyMap,
      urlKeys,
      initialSearchParams,
      unwrapSignals(queuedQueries),
      queryRef,
      stateRef
    )
    if (hasChanged) {
      debug('[nuq+ solid `%s`] State changed: %O', stateKeys, {
        state,
        initialSearchParams,
        queuedQueries,
        queryRef,
        stateRef
      })
      stateRef = state
      setInternalState(() => state)
    }
    queryRef = Object.fromEntries(
      Object.values(resolvedUrlKeys()).map(urlKey => [
        urlKey,
        initialSearchParams?.get(urlKey) ?? null
      ])
    )
  }

  createEffect(() => {
    const { state, hasChanged } = parseMap(
      keyMap,
      urlKeys,
      initialSearchParams,
      unwrapSignals(queuedQueries),
      queryRef,
      stateRef
    )
    if (hasChanged) {
      debug("[solid-querystates `%s`] State changed: %O", stateKeys, {
        state,
        initialSearchParams,
        queuedQueries,
        queryRef,
        stateRef,
      })
      stateRef = state
      setInternalState(() => state)
    }
  })

  createEffect(() => {
    function updateInternalState(state: V) {
      debug("[solid-querystates `%s`] updateInternalState %O", stateKeys, state);
      stateRef = state;
      setInternalState(() => state)
    }

    const handlers = Object.keys(keyMap).reduce(
      (handlers, stateKey) => {
        handlers[stateKey as keyof KeyMap] = ({
          state,
          query,
        }: CrossHookSyncPayload) => {
          const { defaultValue } = keyMap[stateKey]!
          const urlKey = resolvedUrlKeys()[stateKey]!
          stateRef = {
            ...stateRef,
            [stateKey as keyof KeyMap]: state ?? defaultValue ?? null,
          }
          queryRef[urlKey] = query;
          debug(
            "[solid-querystates `%s`] Cross-hook key sync %s: %O (default: %O). Resolved: %O",
            stateKeys,
            urlKey,
            state,
            defaultValue,
            stateRef
          )
          updateInternalState(stateRef);
        }
        return handlers;
      },
      {} as Record<keyof KeyMap, (payload: CrossHookSyncPayload) => void>
    )

    for (const stateKey of Object.keys(keyMap)) {
      const urlKey = resolvedUrlKeys()[stateKey]!
      debug(
        '[nuq+ %s `%s`] Subscribing to sync for `%s`',
        hookId,
        urlKey,
        stateKeys
      )
      emitter.on(urlKey, handlers[stateKey]!)
    }
    onCleanup(() => {
      for (const stateKey of Object.keys(keyMap)) {
        const urlKey = resolvedUrlKeys()[stateKey]!
        debug(
          "[solid-querystates `%s`] Unsubscribing to sync for `%s`",
          urlKey,
          stateKeys
        );
        emitter.off(urlKey, handlers[stateKey])
      }
    })
  })

  const update: SetValues<KeyMap> = async (stateUpdater, callOptions = {}) => {
    const nullMap = Object.fromEntries(
      Object.keys(keyMap).map(key => [key, null])
    ) as Nullable<KeyMap>

    const newState: Partial<Nullable<KeyMap>> =
      typeof stateUpdater === "function"
        ? (stateUpdater(
          applyDefaultValues(stateRef, defaultValues())
        ) ?? nullMap)
        : stateUpdater ?? nullMap

    debug("[solid-querystates `%s`] setState: %O", stateKeys, newState)
    let returnedPromise: Promise<URLSearchParams> | undefined = undefined
    let maxDebounceTime = 0

    const debounceAborts: Array<(p: Promise<URLSearchParams>) =>
      Promise<URLSearchParams>> = []

    for (let [stateKey, value] of Object.entries(newState)) {
      const parser = keyMap[stateKey]
      const urlKey = resolvedUrlKeys()[stateKey]!
      if (!parser) continue
      if (
        (callOptions.clearOnDefault ?? parser.clearOnDefault ?? clearOnDefault) &&
        value !== null &&
        parser.defaultValue !== undefined &&
        (parser.eq ?? ((a, b) => a === b))(value, parser.defaultValue)
      ) {
        value = null
      }
      const query = value === null ? null : (parser.serialize ?? String)(value)
      emitter.emit(urlKey, { state: value, query })
      const updateArgs: UpdateQueuePushArgs = {
        key: urlKey,
        query,
        options: {
          history: callOptions.history ?? parser.history ?? history,
          shallow: callOptions.shallow ?? parser.shallow ?? shallow,
          scroll: callOptions.scroll ?? parser.scroll ?? scroll,
          startTransition:
            callOptions.startTransition ??
            parser.startTransition ??
            startTransition,
        },
      }
      if (
        callOptions?.limitUrlUpdates?.method === "debounce" ||
        limitUrlUpdates?.method === "debounce" ||
        parser.limitUrlUpdates?.method === "debounce"
      ) {
        if (updateArgs.options.shallow === true) {
          console.warn(error(422))
        }
        const timeMs =
          callOptions?.limitUrlUpdates?.timeMs ??
          limitUrlUpdates?.timeMs ??
          parser.limitUrlUpdates?.timeMs ??
          defaultRateLimit.timeMs
        const debouncedPromise = debounceController.push(
          updateArgs,
          timeMs,
          adapter
        );
        if (maxDebounceTime < timeMs) {
          returnedPromise = debouncedPromise
          maxDebounceTime = timeMs
        }
      } else {
        const timeMs =
          callOptions?.limitUrlUpdates?.timeMs ??
          parser?.limitUrlUpdates?.timeMs ??
          limitUrlUpdates?.timeMs ??
          callOptions.throttleMs ??
          parser.throttleMs ?? throttleMs
        debounceAborts.push(debounceController.abort(urlKey))
        globalThrottleQueue.push(updateArgs, timeMs)
      }
    }

    const globalPromise = debounceAborts.reduce(
      (previous, fn) => fn(previous),
      globalThrottleQueue.flush(adapter, processUrlSearchParams)
    )
    return returnedPromise ?? globalPromise;
  }

  const outputState = () => applyDefaultValues(internalState(), defaultValues())
  return [outputState, update]
}

function parseMap<KeyMap extends CreateQueryStatesKeysMap>(
  keyMap: KeyMap,
  urlKeys: Partial<Record<keyof KeyMap, string>>,
  searchParams: URLSearchParams | null,
  queuedQueries: Record<string, Query | null | undefined>,
  cachedQuery?: Record<string, Query | null>,
  cachedState?: NullableValues<KeyMap>
): {
  state: NullableValues<KeyMap>;
  hasChanged: boolean;
} {
  let hasChanged = false;
  const state = Object.entries(keyMap).reduce((out, [stateKey, parser]) => {
    const urlKey = urlKeys?.[stateKey] ?? stateKey;
    const queuedQuery = queuedQueries[urlKey];
    const fallbackValue = parser.type === 'multi' ? [] : null;
    const query =
      queuedQuery === undefined
        ? (
          (parser.type === 'multi'
            ? searchParams?.getAll(urlKey)
            : searchParams?.get(urlKey)) ?? fallbackValue
        )
        : queuedQuery;
    if (
      cachedQuery &&
      cachedState &&
      compareQuery(cachedQuery[urlKey] ?? fallbackValue, query)
    ) {
      out[stateKey as keyof KeyMap] = cachedState[stateKey] ?? null;
      return out;
    }
    hasChanged = true;
    const value = isAbsentFromUrl(query)
      ? null
      : safeParse(parser.parse, query as string & Array<string>, urlKey);
    out[stateKey as keyof KeyMap] = value ?? null;
    if (cachedQuery) {
      cachedQuery[urlKey] = query;
    }
    return out;
  }, {} as NullableValues<KeyMap>);

  if (!hasChanged && cachedState) {
    const keyMapKeys = Object.keys(keyMap);
    const cachedStateKeys = Object.keys(cachedState);
    hasChanged =
      keyMapKeys.length !== cachedStateKeys.length ||
      keyMapKeys.some(key => !cachedStateKeys.includes(key));
  }
  return { state, hasChanged };
}

function applyDefaultValues<KeyMap extends CreateQueryStatesKeysMap>(
  state: NullableValues<KeyMap>,
  defaults: Partial<Values<KeyMap>>
) {
  return Object.fromEntries(
    Object.keys(defaults).map(key => [key, state[key] ?? defaults[key] ?? null])
  ) as Values<KeyMap>;
}

