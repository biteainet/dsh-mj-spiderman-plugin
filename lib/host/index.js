/**
 * dsh-mj-spiderman-plugin host half.
 *
 * The 4 effect videos are embedded as base64 modules (video1.js..video4.js).
 * The injected browser client cannot reach "./videoN.mp4" from the DSH page,
 * so this host half serves them through the DSH webServer under
 * /dsh-mj-spiderman-plugin/media/videoN (Range supported, required by the
 * <video> element). The client plays those relative URLs directly.
 */
import { video1 } from '../video1.js'
import { video2 } from '../video2.js'
import { video3 } from '../video3.js'
import { video4 } from '../video4.js'

export const name = 'dsh-mj-spiderman-plugin'
/** The webserver routes are the only host service this plugin needs. */
export const inject = ['webServer']

const BASE_ROUTE = '/dsh-mj-spiderman-plugin'
const MEDIA_ROUTE = BASE_ROUTE + '/media'
const CONTENT_TYPE = 'video/mp4'

const MEDIA = {
  video1: { b64: video1 },
  video2: { b64: video2 },
  video3: { b64: video3 },
  video4: { b64: video4 },
}

/** Decode lazily, keep the Buffers in a small cache (each is 0.3-1.5MB). */
const buffers = new Map()
function bufferOf(name) {
  if (buffers.has(name)) return buffers.get(name)
  const item = MEDIA[name]
  if (item === undefined) return null
  const buf = Buffer.from(item.b64, 'base64')
  buffers.set(name, buf)
  return buf
}

/** Serve GET/HEAD /media/<name>, honouring Range (video seeks require it). */
function serveMedia(req, res) {
  try {
    const raw = typeof req.url === 'string' ? req.url : ''
    const path = raw.split('?')[0]
    const name = path.length > MEDIA_ROUTE.length + 1 ? decodeURIComponent(path.slice(MEDIA_ROUTE.length + 1)) : ''
    const buf = name === '' ? null : bufferOf(name)
    if (buf === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('dsh-mj-spiderman-plugin: no such video')
      return
    }
    const size = buf.length
    const etag = '"' + size.toString(16) + '-' + name + '"'
    const validators = { etag, 'accept-ranges': 'bytes', 'content-type': CONTENT_TYPE, 'cache-control': 'public, max-age=31536000, immutable' }

    const inm = req.headers['if-none-match']
    if (typeof inm === 'string' && inm.split(',').map((c) => c.trim()).some((c) => c === etag || c === '*')) {
      res.writeHead(304, validators)
      res.end()
      return
    }

    const range = req.headers.range
    if (typeof range === 'string') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (match !== null) {
        const rawStart = match[1]
        const rawEnd = match[2]
        let start = rawStart === '' ? undefined : Number(rawStart)
        let end = rawEnd === '' ? undefined : Number(rawEnd)
        if (start === undefined && end !== undefined) {
          start = Math.max(0, size - end)
          end = size - 1
        }
        if (start !== undefined && end === undefined) end = size - 1
        const valid = start !== undefined && end !== undefined && Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size
        if (!valid) {
          res.writeHead(416, { 'content-range': 'bytes */' + String(size), 'cache-control': 'no-store' })
          res.end()
          return
        }
        end = Math.min(end, size - 1)
        const body = buf.subarray(start, end + 1)
        res.writeHead(206, {
          ...validators,
          'content-length': String(body.length),
          'content-range': 'bytes ' + String(start) + '-' + String(end) + '/' + String(size),
        })
        if (req.method === 'HEAD') { res.end(); return }
        res.end(body)
        return
      }
    }

    res.writeHead(200, { ...validators, 'content-length': String(size) })
    if (req.method === 'HEAD') { res.end(); return }
    res.end(buf)
  } catch (cause) {
    try {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('dsh-mj-spiderman-plugin: media error')
    } catch { /* headers already sent */ }
  }
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: MEDIA_ROUTE, handler: serveMedia }),
    'dsh-mj-spiderman-plugin: media',
  )
}
