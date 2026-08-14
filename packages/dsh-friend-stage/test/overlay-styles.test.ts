import { describe, expect, it } from 'vitest'

import { mountFriendStageOverlay } from '../src/overlay.ts'
import {
  FRIEND_OVERLAY_CSS,
  FRIEND_OVERLAY_STYLE_ID,
  ensureFriendOverlayStyles,
  isOverlayStyleDocument,
  releaseFriendOverlayStyles,
  type OverlayStyleDocument,
  type OverlayStyleNode,
} from '../src/overlay-styles.ts'
import { createFakeOverlayDocument, createFakeOverlayWindow } from './helpers/overlay-dom.ts'

describe('float overlay stylesheet injection', () => {
  it('injects the chrome rules once and releases the tag on demand', () => {
    const documentLike = createStyleDocument()
    ensureFriendOverlayStyles(documentLike)
    expect(documentLike.head.nodes).toHaveLength(1)
    expect(documentLike.head.nodes[0]?.id).toBe(FRIEND_OVERLAY_STYLE_ID)
    expect(documentLike.head.nodes[0]?.textContent).toBe(FRIEND_OVERLAY_CSS)

    ensureFriendOverlayStyles(documentLike)
    expect(documentLike.head.nodes).toHaveLength(1)

    releaseFriendOverlayStyles(documentLike)
    expect(documentLike.getElementById(FRIEND_OVERLAY_STYLE_ID)).toBeNull()
    expect(documentLike.head.nodes).toHaveLength(0)
  })

  it('places grab cursors and the four resize corners in the stylesheet', () => {
    expect(FRIEND_OVERLAY_CSS).toContain('.dsh-friend-float-chrome')
    expect(FRIEND_OVERLAY_CSS).toContain('.dsh-friend-float-drag')
    expect(FRIEND_OVERLAY_CSS).toContain('cursor: grab')
    expect(FRIEND_OVERLAY_CSS).toContain('[data-resize="top-left"]')
    expect(FRIEND_OVERLAY_CSS).toContain('[data-resize="top-right"]')
    expect(FRIEND_OVERLAY_CSS).toContain('[data-resize="bottom-left"]')
    expect(FRIEND_OVERLAY_CSS).toContain('[data-resize="bottom-right"]')
    expect(FRIEND_OVERLAY_CSS).toContain('cursor: nwse-resize')
    expect(FRIEND_OVERLAY_CSS).toContain('cursor: nesw-resize')
    expect(FRIEND_OVERLAY_CSS).toContain('background: transparent')
    expect(FRIEND_OVERLAY_CSS).toContain('opacity: 0')
    expect(FRIEND_OVERLAY_CSS).toContain('.dsh-friend-float-chrome:hover .dsh-friend-float-drag')
    expect(FRIEND_OVERLAY_CSS).toContain('[data-dragging="true"]')
    expect(FRIEND_OVERLAY_CSS).toContain('[data-friend-bubble][hidden]')
    expect(FRIEND_OVERLAY_CSS).toContain('max-height: 36%')
    expect(FRIEND_OVERLAY_CSS).toContain('overflow-y: auto')
  })

  it('skips injection on the jsdom-less overlay fake that has no head', () => {
    const document = createFakeOverlayDocument()
    expect(isOverlayStyleDocument(document)).toBe(false)
  })

  it('mount injects the stylesheet and dispose removes it', () => {
    const document = createStyleAwareOverlayDocument()
    const handle = mountFriendStageOverlay({
      document,
      window: createFakeOverlayWindow(),
    })
    expect(document.getElementById(FRIEND_OVERLAY_STYLE_ID)?.textContent).toBe(FRIEND_OVERLAY_CSS)
    handle.dispose()
    expect(document.getElementById(FRIEND_OVERLAY_STYLE_ID)).toBeNull()
  })
})

function createStyleDocument(): OverlayStyleDocument & {
  head: { nodes: OverlayStyleNode[]; appendChild(node: OverlayStyleNode): void }
} {
  const nodes: OverlayStyleNode[] = []
  return {
    getElementById(id: string) {
      return nodes.find((node) => node.id === id) ?? null
    },
    createElement() {
      return createStyleNode(nodes)
    },
    head: {
      nodes,
      appendChild(node: OverlayStyleNode) {
        if (!nodes.includes(node)) nodes.push(node)
      },
    },
  }
}

function createStyleAwareOverlayDocument() {
  const base = createFakeOverlayDocument()
  const nodes: OverlayStyleNode[] = []
  const originalCreate = base.createElement.bind(base)
  return Object.assign(base, {
    createElement(tag: string) {
      const element = originalCreate(tag)
      if (tag !== 'style') return element
      return createStyleNode(nodes)
    },
    getElementById(id: string) {
      return nodes.find((node) => node.id === id) ?? null
    },
    head: {
      nodes,
      appendChild(node: OverlayStyleNode) {
        if (!nodes.includes(node)) nodes.push(node)
      },
    },
  })
}

function createStyleNode(nodes: OverlayStyleNode[]): OverlayStyleNode {
  const node: OverlayStyleNode = {
    id: '',
    textContent: '',
    remove() {
      const index = nodes.indexOf(node)
      if (index >= 0) nodes.splice(index, 1)
    },
  }
  return node
}
