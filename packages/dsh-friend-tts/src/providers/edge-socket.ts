import WebSocket from 'ws'

import type { EdgeSocket, EdgeSocketFactory } from './edge-protocol.ts'

/** Real WSS transport. Unit tests inject a mock and never import this file. */
export const openEdgeWebSocket: EdgeSocketFactory = (url, headers) => {
  const socket = new WebSocket(url, { headers: { ...headers } })
  socket.binaryType = 'arraybuffer'
  return socket
}
