import {
  createEffect,
  mergeProps,
  type JSX,
  type Component,
  createSignal
} from 'solid-js'
import { resetQueues } from '../lib/queues/reset'
import { AdapterContext, type AdapterProps } from './lib/context'
import type { AdapterOptions, AdapterInterface } from './lib/defs'
import { renderQueryString } from './custom'

export type UrlUpdateEvent = {
  searchParams: URLSearchParams
  queryString: string
  options: Required<AdapterOptions>
}

export type OnUrlUpdateFunction = (event: UrlUpdateEvent) => void

type TestingAdapterProps = {
  /**
   * An initial value for the search params.
   */
  searchParams?: string | Record<string, string> | URLSearchParams

  /**
   * A function that will be called whenever the URL is updated.
   * Connect that to a spy in your tests to assert the URL updates.
   */
  onUrlUpdate?: OnUrlUpdateFunction

  /**
   * Internal: enable throttling during tests.
   *
   * @default 0 (no throttling)
   */
  rateLimitFactor?: number

  /**
   * Internal: Whether to reset the url update queue on mount.
   *
   * Since the update queue is a shared global, each test clears
   * it on mount to avoid interference between tests.
   *
   * @default true
   */
  resetUrlUpdateQueueOnMount?: boolean

  /**
   * If true, the adapter will store the search params in memory and
   * update that memory on each updateUrl call, to simulate a real adapter.
   *
   * Otherwise, the search params will be frozen to the initial value.
   *
   * @default false
   */
  hasMemory?: boolean

  children: JSX.Element
} & AdapterProps

function renderInitialSearchParams(
  searchParams: TestingAdapterProps['searchParams']
): string {
  if (!searchParams) {
    return ''
  }
  if (typeof searchParams === 'string') {
    return searchParams
  }
  if (searchParams instanceof URLSearchParams) {
    return searchParams.toString()
  }
  return new URLSearchParams(searchParams).toString()
}


export const NuqsTestingAdapter: Component<TestingAdapterProps> = (rawProps) => {
  const props = mergeProps({
    resetUrlUpdateQueueOnMount: true,
    rateLimitFactor: 0,
    hasMemory: false,
    searchParams: ''
  }, rawProps)

  const renderedInitialSearchParams = renderInitialSearchParams(props.searchParams)
  // Simulate a central location.search in memory
  // for the getSearchParamsSnapshot to be referentially stable
  let locationSearchRef = renderedInitialSearchParams
  if (props.resetUrlUpdateQueueOnMount) {
    resetQueues()
  }
  const [searchParams, setSearchParams] = createSignal(
    new URLSearchParams(locationSearchRef)
  )

  createEffect(() => {
    if (props.hasMemory) {
      const synced = new URLSearchParams(props.searchParams)
      setSearchParams(synced)
      locationSearchRef = synced.toString()
    }
    // Cleanup not needed because the effect will only run when `hasMemory`
    // or `searchParams` changes
  })

  const updateUrl: AdapterInterface['updateUrl'] = (search, options) => {
    const queryString = renderQueryString(search())
    const urlSearchParams = new URLSearchParams(search())
    if (props.hasMemory) {
      setSearchParams(urlSearchParams);
      locationSearchRef = queryString;
    }
    props.onUrlUpdate?.({
      searchParams: urlSearchParams,
      queryString,
      options
    });
  }

  const getSearchParamsSnapshot = () => {
    return new URLSearchParams(locationSearchRef)
  }

  const useAdapter = (): AdapterInterface => ({
    searchParams,
    updateUrl,
    getSearchParamsSnapshot,
    rateLimitFactor: props.rateLimitFactor
  })

  const contextValue = {
    useAdapter,
    defaultOptions: props.defaultOptions,
    processUrlSeachParams: props.processUrlSearchParams
  }

  return (
    <AdapterContext.Provider value={contextValue}>
      {props.children}
    </AdapterContext.Provider>
  )
}

/**
 * A higher order component that wraps the children with the NuqsTestingAdapter
 *
 * It allows creating wrappers for testing purposes by providing only the
 * necessary props to the NuqsTestingAdapter.
 *
 * Usage:
 * ```tsx
 * render(<MyComponent />, {
 *   wrapper: withNuqsTestingAdapter({ searchParams: '?foo=bar' })
 * })
 * ```
 */
export function withNuqsTestingAdapter(
  props: Omit<TestingAdapterProps, "children"> = {}
) {
  return function NuqsTestingAdapterWrapper(wrapperProps: { children: JSX.Element }) {
    // Merge in provided props and wrapperProps.children
    const merged = mergeProps(props, { children: wrapperProps.children })
    return <NuqsTestingAdapter {...merged} />
  };
}
