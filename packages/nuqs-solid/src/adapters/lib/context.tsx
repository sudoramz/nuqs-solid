import {
  createContext,
  useContext,
  type Context,
  type JSX,
  type ParentComponent
} from 'solid-js'
import { Options } from '../../defs'
import { AdapterInterface, UseAdapterHook } from './defs'
import { error } from '../../lib/errors'
import { debugEnabled } from '../../lib/debug'

export type AdapterProps = {
  defaultOptions?: Partial<
    Pick<Options, 'shallow' | 'clearOnDefault' | 'scroll' | 'limitUrlUpdates'>
  >
  processUrlSearchParams?: (search: URLSearchParams) => URLSearchParams
}

export type AdapterContextValue = AdapterProps & {
  useAdapter: UseAdapterHook
}

export const AdapterContext: Context<AdapterContextValue> = createContext<AdapterContextValue>({
  useAdapter() {
    throw new Error(error(404))
  }
})

declare global {
  interface Window {
    __NuqsAdapterContext?: typeof AdapterContext;
  }
}

if (debugEnabled && typeof window !== 'undefined') {
  if (
    window.__NuqsAdapterContext &&
    window.__NuqsAdapterContext !== AdapterContext
  ) {
    console.error(error(303));
  }
  window.__NuqsAdapterContext = AdapterContext;
}

export type AdapterProvider = ParentComponent<AdapterProps>

export function createAdapterProvider(
  useAdapter: UseAdapterHook
): AdapterProvider {
  return (props: AdapterProps & { children?: JSX.Element }) => {
    const value: AdapterContextValue = {
      useAdapter,
      defaultOptions: props.defaultOptions,
      processUrlSearchParams: props.processUrlSearchParams,
    };

    return (
      <AdapterContext.Provider value={value}>
        {props.children}
      </AdapterContext.Provider>
    )
  }
}

export function useAdapter(watchKeys: Array<string>): AdapterInterface {
  const value = useContext(AdapterContext)
  if (!value || !('useAdapter' in value)) {
    throw new Error(error(404))
  }

  return value.useAdapter(watchKeys)
}

export const useAdapterDefaultOptions = (): AdapterProps['defaultOptions'] =>
  useContext(AdapterContext).defaultOptions

export const useAdapterProcessUrlSearchParams = (): AdapterProps['processUrlSearchParams'] => useContext(AdapterContext).processUrlSearchParams
