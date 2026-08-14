import type { IncomingMessage, ServerResponse } from 'node:http'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { headerValue, isGet, queryParam, readJsonBody, readZipUpload, writeJson, writeText } from './http-util.ts'
import {
  MAX_MODEL_ZIP_BYTES,
  deleteUserModel,
  pendingBuiltinNailongInstall,
  readFriendMap,
  readModelCatalog,
  resolveCurrentModel,
  selectCurrentModel,
  uploadModelZip,
  ModelUploadError,
} from './models.ts'

export type ModelRouteOptions = Readonly<{
  dataRoot: string
  maxBytes?: number
}>

export function createModelRoutes(options: ModelRouteOptions): readonly WebRoute[] {
  const dataRoot = options.dataRoot
  const maxBytes = options.maxBytes ?? MAX_MODEL_ZIP_BYTES

  return [
    {
      kind: 'exact',
      path: '/friend/models',
      async handler(request, response) {
        if (!isGet(request)) return writeText(response, 'Method Not Allowed', 405)
        await pendingBuiltinNailongInstall(dataRoot)?.catch(() => undefined)
        writeJson(response, await readModelCatalog(dataRoot))
      },
    },
    {
      kind: 'exact',
      path: '/friend/models/current',
      async handler(request, response) {
        if (!isGet(request)) return writeText(response, 'Method Not Allowed', 405)
        const model = await resolveCurrentModel(dataRoot)
        writeJson(response, { ...model, map: await readFriendMap(dataRoot, model) })
      },
    },
    {
      kind: 'exact',
      path: '/friend/models/upload',
      async handler(request, response) {
        if (request.method !== 'POST') return writeText(response, 'Method Not Allowed', 405)
        try {
          const upload = await readZipUpload(request, maxBytes)
          const result = await uploadModelZip({
            dataRoot,
            archive: upload.archive,
            maxBytes,
            ...(upload.name !== undefined ? { name: upload.name } : {}),
          })
          writeJson(response, { ok: true, ...result })
        } catch (error) {
          writeModelError(response, error)
        }
      },
    },
    {
      kind: 'exact',
      path: '/friend/models/select',
      async handler(request, response) {
        if (request.method !== 'POST') return writeText(response, 'Method Not Allowed', 405)
        try {
          const name = await readName(request)
          writeJson(response, { ok: true, ...(await selectCurrentModel(dataRoot, name)) })
        } catch (error) {
          writeModelError(response, error)
        }
      },
    },
    {
      kind: 'exact',
      path: '/friend/models/delete',
      async handler(request, response) {
        if (request.method !== 'POST') return writeText(response, 'Method Not Allowed', 405)
        try {
          const name = await readName(request)
          writeJson(response, { ok: true, ...(await deleteUserModel(dataRoot, name)) })
        } catch (error) {
          writeModelError(response, error)
        }
      },
    },
  ]
}

async function readName(request: IncomingMessage): Promise<string> {
  const fromQuery = queryParam(request, 'name') ?? headerValue(request, 'x-friend-model-name')
  if (fromQuery !== undefined) return fromQuery
  const body = await readJsonBody(request)
  if (typeof body === 'object' && body !== null && 'name' in body && typeof body.name === 'string') {
    return body.name
  }
  throw new ModelUploadError('name is required')
}

function writeModelError(response: ServerResponse, error: unknown): void {
  const status = error instanceof ModelUploadError ? error.statusCode : 400
  writeJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, status)
}
