export function timeout(
  callback: () => void,
  ms: number,
  signal: AbortSignal
): void {
  function onTick() {
    callback()
    signal.removeEventListener('abort', onAbort)
  }
  const id = setTimeout(onTick, ms)
  function onAbort() {
    clearTimeout(id)
    signal.removeEventListener('abort', onAbort)
  }
  signal.addEventListener('abort', onAbort)
}
