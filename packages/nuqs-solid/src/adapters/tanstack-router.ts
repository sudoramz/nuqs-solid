import {
  useLocation,
  useMatches,
  useNavigate
} from '@tanstack/solid-router'
import {
  startTransition,
  createMemo,
} from 'solid-js'
import { createAdapterProvider, type AdapterProvider } from './lib/context'
import { AdapterInterface, UpdateUrlFunction } from './lib/defs'
import { renderQueryString } from './custom'

function useNuqsTanstackRouterAdapter(watchKeys: Array<string>): AdapterInterface {
  const search = useLocation({
    select: state =>
      Object.fromEntries(
        Object.entries(state.search).filter(([key]) => watchKeys.includes(key))
      )
  })
  const navigate = useNavigate()
  const from = useMatches({
    select: matches =>
      matches.length > 0
        ? (matches[matches.length - 1]?.fullPath as string)
        : undefined
  })
  const searchParams = createMemo(
    () =>
      // search is a Record<string, string | number | object | Array<string | number>>,
      // so we need to flatten it into a list of key/value pairs,
      // replicating keys that have multiple values before passing it
      // to URLSearchParams, otherwise { foo: ['bar', 'baz'] }
      // ends up as { foo → 'bar,baz' } instead of { foo → 'bar', foo → 'baz' }
      new URLSearchParams(
        Object.entries(search).flatMap(([key, value]) => {
          if (Array.isArray(value)) {
            return value.map(v => [key, v])
          } else if (typeof value === 'object' && value !== null) {
            // TSR JSON.parses objects in the search params,
            // but parseAsJson expects a JSON string,
            // so we need to re-stringify it first.
            return [[key, JSON.stringify(value)]]
          } else {
            return [[key, value]]
          }
        })
      )
  )

  const updateUrl: UpdateUrlFunction = (
    search,
    options
  ) => {
    startTransition(() => {
      navigate({
        from: from(),
        to: renderQueryString(search()) || '',
        replace: options.history === 'replace',
        resetScroll: options.scroll,
        hash: prevHash => prevHash ?? ''
      })
    })
  }

  return {
    searchParams,
    updateUrl,
    rateLimitFactor: 1
  }
}

export const NuqsAdapter: AdapterProvider = createAdapterProvider(
  useNuqsTanstackRouterAdapter
)
