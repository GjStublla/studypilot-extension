/***
 * live-token — Supabase Edge Function (Vertex AI WebSocket Proxy)
 *
 * Uses npm:ws + Node.js HTTP server (same pattern as the official Supabase
 * OpenAI relay example) so we can pass Authorization headers on the outbound
 * Vertex AI connection — something Deno's built-in WebSocket cannot do.
 *
 * Deploy with --no-verify-jwt:
 *   supabase functions deploy live-token --no-verify-jwt --project-ref <ref>
 *
 * Required secrets:
 *   GOOGLE_CLIENT_EMAIL   GOOGLE_PRIVATE_KEY   GOOGLE_PROJECT_ID
 *   VERTEX_LOCATION       VERTEX_MODEL
 */

import { createServer } from "node:http"
import { WebSocketServer, WebSocket } from "npm:ws@^8"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const TOKEN_LIFETIME_SECONDS = 3600
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

// ── RS256 JWT + OAuth2 ────────────────────────────────────────────────────────

function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function signRS256(data: string, pem: string): Promise<string> {
  const clean = pem.replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const der = Uint8Array.from(atob(clean), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  return base64url(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data),
  ))
}

async function mintAccessToken(email: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const h = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).buffer)
  const p = base64url(new TextEncoder().encode(JSON.stringify({
    iss: email, sub: email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: OAUTH_SCOPE, iat: now, exp: now + TOKEN_LIFETIME_SECONDS,
  })).buffer)
  const jwt = `${h}.${p}.${await signRS256(`${h}.${p}`, privateKey)}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!res.ok) throw new Error(`OAuth2 failed (${res.status}): ${await res.text()}`)
  const data = await res.json() as { access_token?: string }
  if (!data.access_token) throw new Error('No access_token in OAuth2 response')
  return data.access_token
}

// ── Config ────────────────────────────────────────────────────────────────────

const clientEmail = Deno.env.get('GOOGLE_CLIENT_EMAIL') ?? ''
const privateKey  = Deno.env.get('GOOGLE_PRIVATE_KEY') ?? ''
const projectId   = Deno.env.get('GOOGLE_PROJECT_ID') ?? ''
const location    = Deno.env.get('VERTEX_LOCATION') ?? 'us-central1'
const modelId     = 'gemini-live-2.5-flash-native-audio'
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const model = `projects/${projectId}/locations/${location}/publishers/google/models/${modelId}`
const vertexUrl = `wss://${location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`

console.log(`[live-token] Model: ${model}`)

// ── HTTP + WS server ──────────────────────────────────────────────────────────

const server = createServer()
const wss = new WebSocketServer({ noServer: true })

wss.on('connection', async (clientWs: WebSocket, jwt: string) => {
  console.log(`[live-token] WS client connected`)

  if (!clientEmail || !privateKey || !projectId) {
    clientWs.close(1011, 'Vertex AI not configured')
    return
  }

  let accessToken: string
  try {
    accessToken = await mintAccessToken(clientEmail, privateKey)
    console.log(`[live-token] OAuth2 token minted OK`)
  } catch (err) {
    console.error(`[live-token] Token mint failed: ${err}`)
    clientWs.close(1011, 'Auth failed')
    return
  }

  // Open outbound connection to Vertex AI with Authorization header
  const vertexWs = new WebSocket(vertexUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })

  console.log(`[live-token] Connecting to Vertex AI...`)

  vertexWs.on('open', () => {
    console.log(`[live-token] Vertex socket open OK`)
  })

  // Client → Vertex
  clientWs.on('message', (data: Buffer | string) => {
    if (vertexWs.readyState !== WebSocket.OPEN) return
    // Inject model into setup frame if missing, strip unsupported fields
    if (typeof data === 'string' || Buffer.isBuffer(data)) {
      const str = typeof data === 'string' ? data : data.toString()
      try {
        const msg = JSON.parse(str)
        if (msg?.setup) {
          if (!msg.setup.model) msg.setup.model = model
          if (msg.setup.generationConfig?.speechConfig) {
            delete msg.setup.generationConfig.speechConfig
          }
          console.log(`[live-token] Setup → Vertex model: ${msg.setup.model}`)
          vertexWs.send(JSON.stringify(msg))
          return
        }
      } catch { /* not JSON */ }
    }
    vertexWs.send(data)
  })

  clientWs.on('close', (code: number, reason: Buffer) => {
    console.log(`[live-token] Client closed ${code} ${reason}`)
    if (vertexWs.readyState < WebSocket.CLOSING) vertexWs.close(1000, 'Client disconnected')
  })

  clientWs.on('error', (err: Error) => {
    console.error(`[live-token] Client error: ${err.message}`)
  })

  // Vertex → Client
  vertexWs.on('message', (data: Buffer | string) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data)
  })

  vertexWs.on('close', (code: number, reason: Buffer) => {
    console.log(`[live-token] Vertex closed ${code} ${reason}`)
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code || 1000, reason?.toString() || 'Vertex disconnected')
    }
  })

  vertexWs.on('error', (err: Error) => {
    console.error(`[live-token] Vertex error: ${err.message}`)
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011, 'Vertex error')
  })
})

server.on('upgrade', async (req, socket, head) => {
  // Auth: JWT in ?jwt= query param
  const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const jwt = reqUrl.searchParams.get('jwt') ?? ''

  if (!jwt) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  const supabase = createClient(supabaseUrl, supabaseKey)
  const { data: { user }, error } = await supabase.auth.getUser(jwt)

  if (error || !user) {
    console.error(`[live-token] Auth failed: ${error?.message}`)
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  console.log(`[live-token] WS upgrade user=${user.id}`)

  // Also handle plain HTTP requests (for the HTTP preflight from the client)
  if (!req.headers.upgrade || req.headers.upgrade.toLowerCase() !== 'websocket') {
    const body = JSON.stringify({
      webSocketUrl: `${supabaseUrl.replace(/\/$/, '').replace(/^https?:\/\//, 'wss://')}/functions/v1/live-token?jwt=${encodeURIComponent(jwt)}`,
      accessToken: jwt,
      model,
      expiresAt: new Date(Date.now() + TOKEN_LIFETIME_SECONDS * 1000).toISOString(),
    })
    socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`)
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, jwt)
  })
})

server.listen(8080)
