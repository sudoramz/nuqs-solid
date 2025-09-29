import { createMemo, type Accessor } from "solid-js";
import type { Options } from "./defs";
import type { GenericParser } from './parsers'
import { createQueryStates } from "./create-query-states";

export type CreateQueryStateOptions<T> = GenericParser<T> & Options;

export type CreateQueryStateReturn<Parsed, Default> = [
  Accessor<Default extends undefined
    ? Parsed | null // value can be null if no default
    : Parsed>,
  (
    value:
      | null
      | Parsed
      | ((
        old: Default extends Parsed ? Parsed : Parsed | null
      ) => Parsed | null),
    options?: Options
  ) => Promise<URLSearchParams>
];

// Overload signatures for various input types (keep order: most specific first)
/**
 * SolidJS reactive state composable synchronized with a URL query string.
 * This variant is used with a default value, returning a non-nullable value.
 */
export function createQueryState<T>(
  key: string,
  options: CreateQueryStateOptions<T> & { defaultValue: T }
): CreateQueryStateReturn<
  NonNullable<ReturnType<typeof options.parse>>,
  typeof options.defaultValue
>;

/**
 * SolidJS string-based state for query param with default value, limited options.
 */
export function createQueryState(
  key: string,
  options: Options & {
    defaultValue: string;
  } & {
    [K in keyof GenericParser<unknown>]?: never;
  }
): CreateQueryStateReturn<string, typeof options.defaultValue>;

/**
 * SolidJS string-based state, limited options, no default.
 */
export function createQueryState(
  key: string,
  options: Pick<CreateQueryStateOptions<string>, keyof Options>
): CreateQueryStateReturn<string, undefined>;

/**
 * SolidJS string-based state, no options or parser - default type string, could be null.
 */
export function createQueryState(
  key: string
): CreateQueryStateReturn<string, undefined>;

/**
 * Returns a signal and updater for a URL query string parameter.
 *
 * Usage:
 *   const [count, setCount] = createQueryState("count", { defaultValue: 0 });
 *   count(); // Reactive getter for query value
 *   setCount(newVal); // Update the query param
 *
 * @param key - The URL query string key
 * @param options - Optional parser, default value, and options
 */
export function createQueryState<T = string>(
  key: string,
  options: Partial<CreateQueryStateOptions<T>> & { defaultValue?: T } = {}
): CreateQueryStateReturn<T, typeof options.defaultValue> {
  const { parse, type, serialize, eq, defaultValue, ...hookOptions } = options;

  const [accessor, setState] = createQueryStates(
    {
      [key]: {
        parse: parse ?? ((x: any) => x as unknown as T),
        type,
        serialize,
        eq,
        defaultValue,
      } as GenericParser<T>,
    },
    hookOptions
  );

  // Memoized signal for just this query key (reactive getter)
  const state = createMemo(() => accessor()[key]);

  const update: CreateQueryStateReturn<T, typeof options.defaultValue>[1] = (
    stateUpdater,
    callOptions = {}
  ) =>
    setState(
      // @ts-expect-error - TypeScript struggles to reconcile the dynamic `[key]`
      // with the complex generic type of the updater's return value.
      old => {
        const newValue =
          typeof stateUpdater === 'function'
            ? (stateUpdater as (oldValue: T | null) => T | null)(old[key])
            : stateUpdater
        return {
          [key]: newValue,
        } as Partial<Record<string, T | null>>
      },
      callOptions
    )

  return [state, update]
}
