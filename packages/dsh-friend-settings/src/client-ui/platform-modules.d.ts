declare module 'react' {
  export type ReactNode = unknown
  export type Dispatch<A> = (value: A) => void
  export type SetStateAction<S> = S | ((prev: S) => S)
  export function createElement(
    type: unknown,
    props?: object | null,
    ...children: unknown[]
  ): unknown
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T
  const React: {
    createElement: typeof createElement
  }
  export default React
}

declare module 'react-dom/client' {
  export function createRoot(container: { id: string }): {
    render(node: unknown): void
    unmount(): void
  }
}

declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: object, key?: string): unknown
  export function jsxs(type: unknown, props: object, key?: string): unknown
  export const Fragment: unique symbol
}

declare namespace React {
  type ReactNode = unknown
  interface CSSProperties {
    [key: string]: string | number | undefined
  }
}

declare namespace JSX {
  type Element = unknown
  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>
  }
}
