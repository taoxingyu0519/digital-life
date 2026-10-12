import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, request as proxyRequest } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const privateFolder = resolve(workspace, 'airi/.local/lan')
const config = JSON.parse(readFileSync(resolve(privateFolder, 'config.json'), 'utf8'))
const host = `${config.host}:${config.port}`
const origin = `https://${host}`
const access = Buffer.from(config.access)

function hasAccess(value = '') {
  const candidate = Buffer.from(value)
  return candidate.length === access.length && timingSafeEqual(candidate, access)
}

function authorized(request) {
  const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('airi_lan_access='))
  return request.headers.host === host && hasAccess(cookie?.slice('airi_lan_access='.length))
    && (!request.headers.origin || request.headers.origin === origin)
}

// The authenticated TLS edge is the sole LAN boundary. Upstreams remain loopback-only.
function headersFor(request) {
  const headers = { ...request.headers, host: '127.0.0.1:5173' }
  if (headers.origin)
    headers.origin = 'http://127.0.0.1:5173'
  if (headers.referer)
    headers.referer = 'http://127.0.0.1:5173/'
  delete headers.forwarded
  delete headers['x-forwarded-host']
  delete headers['x-forwarded-for']
  delete headers['x-forwarded-proto']
  if (headers.cookie)
    headers.cookie = headers.cookie.split(';').filter(value => !value.trim().startsWith('airi_lan_access=')).join(';')
  return headers
}

const server = createHttpsServer({
  key: readFileSync(resolve(privateFolder, 'server.key')),
  cert: readFileSync(resolve(privateFolder, 'server.pem')),
}, (request, response) => {
  response.setHeader('Referrer-Policy', 'no-referrer')
  const url = new URL(request.url, origin)
  if (request.headers.host === host && url.pathname === '/enter' && hasAccess(url.searchParams.get('access') ?? '')) {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': `airi_lan_access=${config.access}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`,
    }).end('<!doctype html><meta http-equiv="refresh" content="0;url=/"><a href="/">打开 AIRI</a>')
    return
  }
  if (!authorized(request)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('请使用主机提供的私人测试链接打开 AIRI。')
    return
  }
  const upstream = proxyRequest({ host: '127.0.0.1', port: 5173, path: request.url, method: request.method, headers: headersFor(request) }, result => {
    response.writeHead(result.statusCode ?? 502, result.headers)
    result.pipe(response)
  })
  upstream.on('error', () => {
    if (!response.headersSent)
      response.writeHead(502)
    response.end('AIRI Web service is unavailable.')
  })
  request.on('aborted', () => upstream.destroy())
  response.on('close', () => upstream.destroy())
  request.pipe(upstream)
})

server.on('upgrade', (request, socket, head) => {
  if (!authorized(request) || request.headers.origin !== origin) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  const upstream = proxyRequest({ host: '127.0.0.1', port: 5173, path: request.url, headers: headersFor(request) })
  upstream.on('upgrade', (response, stream, upstreamHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`)
    for (let index = 0; index < response.rawHeaders.length; index += 2)
      socket.write(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`)
    socket.write('\r\n')
    if (upstreamHead.length)
      socket.write(upstreamHead)
    if (head.length)
      stream.write(head)
    stream.on('error', () => socket.destroy())
    socket.on('error', () => stream.destroy())
    socket.on('close', () => stream.destroy())
    stream.on('close', () => socket.end())
    stream.pipe(socket).pipe(stream)
  })
  upstream.on('response', response => {
    socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`)
    response.resume()
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
  upstream.end()
})

const certificate = readFileSync(resolve(workspace, '.runtime/lan/airi-lan.cer'))
const setup = createServer((request, response) => {
  if (request.headers.host !== `${config.host}:${config.setupPort}` || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(403).end()
    return
  }
  response.setHeader('Cache-Control', 'no-store')
  if (request.url === '/airi-lan.cer') {
    response.writeHead(200, { 'Content-Type': 'application/pkix-cert', 'Content-Disposition': 'attachment; filename="airi-lan.cer"' }).end(certificate)
    return
  }
  if (request.url !== '/') {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AIRI 笔记本测试准备</title><style>body{font:18px/1.7 system-ui;max-width:700px;margin:70px auto;padding:24px}a{color:#2563eb}</style><h1>AIRI 笔记本测试</h1><p>首次使用请导入此主机的公开 HTTPS 证书。</p><ol><li><a href="/airi-lan.cer">下载 airi-lan.cer</a></li><li>双击证书，点击“安装证书”，选择“当前用户”。</li><li>选择“将所有的证书都放入下列存储”，浏览并选择“受信任的根证书颁发机构”，完成导入。</li><li>重新打开 Edge 或 Chrome，再打开聊天中提供的私人测试链接。</li></ol><p>测试地址：${origin}。麦克风和摄像头由当前笔记本采集。公开证书不包含私钥。</p></html>`)
})
server.listen(config.port, config.host, () => console.log(`AIRI LAN HTTPS: ${origin}`))
setup.listen(config.setupPort, config.host, () => console.log(`AIRI certificate setup: http://${config.host}:${config.setupPort}`))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close()
    setup.close()
  })
}
