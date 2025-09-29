import { startTransition } from "solid-js";

export type TransitionStartFunction = typeof startTransition

export function compose(
  fns: TransitionStartFunction[],
  final: () => void
): void {
  let next = final
  for (let i = fns.length - 1; i >= 0; i--) {
    const fn = fns[i]
    if (!fn) continue
    const prev = next
    next = () => fn(prev)
  }
  next()
}

