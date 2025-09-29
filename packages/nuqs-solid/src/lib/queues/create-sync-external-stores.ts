import { createSignal, onCleanup } from "solid-js";

export function createSyncExternalStores<T>(
  keys: string[],
  subscribeKey: (key: string, callback: () => void) => () => void,
  getKeySnapshot: (key: string) => T
): Record<string, () => T> {
  // Create signals for each key
  const signals: Record<string, [() => T, (v: T) => void]> = {}
  keys.forEach(key => {
    const [getter, setter] = createSignal(getKeySnapshot(key))
    signals[key] = [getter, setter]
  })

  // Subscribe and update signals when state changes
  keys.forEach(key => {
    const update = () => signals[key][1](getKeySnapshot(key))
    const unsubscribe = subscribeKey(key, update)
    onCleanup(unsubscribe)
  })

  // Return an object of reactive getter functions
  const result: Record<string, () => T> = {}
  keys.forEach(key => {
    result[key] = signals[key][0]
  })
  return result
}


