import type { Options } from "../../defs";
import type { Accessor } from "solid-js";

export type AdapterOptions = Pick<Options, 'history' | 'scroll' | 'shallow'>
export type UpdateUrlFunction = (
  search: Accessor<URLSearchParams>,
  options: Required<AdapterOptions>
) => void

export type UseAdapterHook = (watchKeys: Array<string>) => AdapterInterface

export type AdapterInterface = {
  searchParams: Accessor<URLSearchParams>
  updateUrl: UpdateUrlFunction
  getSearchParamsSnapshot?: () => URLSearchParams
  rateLimitFactor?: number
  autoResetQueueOnUpdate?: boolean
}
