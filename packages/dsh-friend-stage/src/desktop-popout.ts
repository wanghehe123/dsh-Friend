export const FRIEND_DESKTOP_POPOUT_EVENT = 'dsh-friend:desktop-popout' as const
export const FRIEND_ASR_YIELD_EVENT = 'dsh-friend:asr-yield' as const
export const FRIEND_ASR_RESUME_EVENT = 'dsh-friend:asr-resume' as const
export const PET_DESKTOP_SRC = '/friend/pet?transparent=1' as const
export const PET_IFRAME_ALLOW = 'microphone; autoplay' as const

export type DesktopPopoutSize = {
  width: number
  height: number
}

export type DesktopPopoutChild = {
  document?: {
    head?: { appendChild(node: DesktopPopoutNode): void }
    body?: { style: { cssText: string }; appendChild(node: DesktopPopoutNode): void }
    createElement(tag: string): DesktopPopoutNode
  }
  addEventListener?(type: string, listener: () => void): void
  close?(): void
}

export type DesktopPopoutNode = {
  textContent: string
  src?: string
  allow?: string
  style: { cssText: string }
  setAttribute?(name: string, value: string): void
}

export type DesktopPopoutHost = {
  documentPictureInPicture?: {
    requestWindow(options: DesktopPopoutSize): Promise<DesktopPopoutChild>
  }
  open?(url: string, target?: string, features?: string): DesktopPopoutChild | null
}

export type DesktopPopoutResult = {
  kind: 'pip' | 'window'
  closed: Promise<void>
}

export function canRequestDesktopPopout(win: DesktopPopoutHost): boolean {
  return typeof win.documentPictureInPicture?.requestWindow === 'function'
    || typeof win.open === 'function'
}

export async function requestDesktopPopout(
  win: DesktopPopoutHost,
  size: DesktopPopoutSize,
): Promise<DesktopPopoutResult | undefined> {
  const width = Math.max(200, Math.floor(size.width))
  const height = Math.max(240, Math.floor(size.height))
  const pip = win.documentPictureInPicture
  if (pip !== undefined && typeof pip.requestWindow === 'function') {
    const child = await pip.requestWindow({ width, height })
    fillPopoutDocument(child, PET_DESKTOP_SRC)
    return { kind: 'pip', closed: watchClosed(child) }
  }
  const opened = win.open?.(
    PET_DESKTOP_SRC,
    'dsh-friend-desktop',
    `popup=yes,width=${width},height=${height}`,
  )
  if (opened === undefined || opened === null) {
    return undefined
  }
  return { kind: 'window', closed: watchClosed(opened) }
}

function fillPopoutDocument(child: DesktopPopoutChild, src: string): void {
  const doc = child.document
  if (doc === undefined) {
    return
  }
  const style = doc.createElement('style')
  style.textContent = 'html,body{margin:0;height:100%;background:transparent;overflow:hidden}iframe{border:0;width:100%;height:100%;background:transparent}'
  doc.head?.appendChild(style)
  if (doc.body !== undefined) {
    doc.body.style.cssText = 'margin:0;height:100%'
  }
  const frame = doc.createElement('iframe')
  frame.src = src
  frame.setAttribute?.('allow', PET_IFRAME_ALLOW)
  frame.allow = PET_IFRAME_ALLOW
  frame.style.cssText = 'width:100%;height:100%;border:0;background:transparent'
  doc.body?.appendChild(frame)
}

function watchClosed(child: DesktopPopoutChild): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) {
        return
      }
      settled = true
      resolve()
    }
    child.addEventListener?.('pagehide', done)
    child.addEventListener?.('unload', done)
  })
}
