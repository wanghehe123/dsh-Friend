import { describe, expect, it } from 'vitest'

import {
  canRequestDesktopPopout,
  PET_DESKTOP_SRC,
  PET_IFRAME_ALLOW,
  requestDesktopPopout,
  type DesktopPopoutChild,
  type DesktopPopoutHost,
  type DesktopPopoutNode,
} from '../src/desktop-popout.ts'

function createPipHost(): {
  host: DesktopPopoutHost
  child: DesktopPopoutChild
  nodes: DesktopPopoutNode[]
  closed: () => void
} {
  const nodes: DesktopPopoutNode[] = []
  let onClose: (() => void) | undefined
  const child: DesktopPopoutChild = {
    document: {
      head: {
        appendChild(node) {
          nodes.push(node)
        },
      },
      body: {
        style: { cssText: '' },
        appendChild(node) {
          nodes.push(node)
        },
      },
      createElement() {
        const node: DesktopPopoutNode = {
          textContent: '',
          style: { cssText: '' },
          setAttribute() {},
        }
        return node
      },
    },
    addEventListener(type, listener) {
      if (type === 'pagehide') {
        onClose = listener
      }
    },
  }
  return {
    host: {
      documentPictureInPicture: {
        async requestWindow() {
          return child
        },
      },
    },
    child,
    nodes,
    closed: () => onClose?.(),
  }
}

describe('desktop popout', () => {
  it('prefers Document Picture-in-Picture and loads the standalone pet page', async () => {
    const world = createPipHost()
    expect(canRequestDesktopPopout(world.host)).toBe(true)
    const result = await requestDesktopPopout(world.host, { width: 280, height: 360 })
    expect(result?.kind).toBe('pip')
    expect(world.nodes.some((node) => node.src === PET_DESKTOP_SRC)).toBe(true)
    expect(world.nodes.some((node) => node.allow === PET_IFRAME_ALLOW)).toBe(true)
    let closed = false
    void result?.closed.then(() => {
      closed = true
    })
    world.closed()
    await Promise.resolve()
    expect(closed).toBe(true)
  })

  it('falls back to window.open when Picture-in-Picture is missing', async () => {
    const opened: string[] = []
    const host: DesktopPopoutHost = {
      open(url) {
        opened.push(url)
        return { addEventListener() {} }
      },
    }
    const result = await requestDesktopPopout(host, { width: 320, height: 400 })
    expect(result?.kind).toBe('window')
    expect(opened).toEqual([PET_DESKTOP_SRC])
  })
})
