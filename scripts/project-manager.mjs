import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { workspaceSourceFiles } from './workspace-source-files.mjs'
import { findWikiTopics, getWikiIndex, readWikiPage, readWikiSource } from './project-wiki.mjs'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(workspace, 'airi')
const folder = resolve(workspace, '项目管理')
const dataPath = resolve(folder, 'tasks.json')
const port = 5174
const origin = `http://127.0.0.1:${port}`
const labels = { todo: '待办', doing: '进行中', done: '已完成', blocked: '待处理' }
const csrf = randomUUID()
let syncState = { at: null, error: null, signature: '' }
const documents = {
  wiki: ['项目管理 Wiki 首页', 'wiki/README.md'],
  'wiki-index': ['Wiki 证据状态', 'wiki/index.md'],
  architecture: ['系统架构', '开发文档/01-system-architecture.md'],
  development: ['开发指南', '开发文档/04-development-guide.md'],
  workflow: ['项目管理说明', '开发文档/05-project-management.md'],
  packages: ['工作区包索引', '开发文档/03-workspace-index.md'],
  tree: ['源码目录树', '开发文档/source-directory-tree.txt'],
  workspace: ['工作区完整文件索引', '开发文档/workspace-source-files.txt'],
  changes: ['当前源码改动', '开发文档/current-changes.md'],
  changelog: ['变更记录', '项目管理/变更记录.md'],
}

function atomicWrite(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, path)
}

function readData() {
  const data = JSON.parse(readFileSync(dataPath, 'utf8'))
  if (data.version !== 1 || !Number.isInteger(data.revision) || !Array.isArray(data.tasks) || !Array.isArray(data.events))
    throw new Error('任务数据格式错误；请检查 tasks.json 或从 tasks.backup.json 恢复。')
  const ids = new Set()
  for (const task of data.tasks) {
    if (!/^AIRI-\d+$/.test(task.id) || ids.has(task.id) || typeof task.title !== 'string' || typeof task.detail !== 'string' || !Object.hasOwn(labels, task.status))
      throw new Error('任务字段格式错误。')
    ids.add(task.id)
  }
  return data
}

const cell = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ')
function renderRecords(data) {
  const lines = ['# AIRI 任务看板', '', '用 [本地项目管理](http://127.0.0.1:5174) 修改任务；数据保存在 tasks.json。', '']
  for (const [status, label] of Object.entries(labels)) {
    lines.push(`## ${label}`, '', '| 编号 | 任务 | 说明 |', '| --- | --- | --- |')
    for (const task of data.tasks.filter(item => item.status === status))
      lines.push(`| ${task.id} | ${cell(task.title)} | ${cell(task.detail)} |`)
    lines.push('')
  }
  atomicWrite(resolve(folder, '看板.md'), lines.join('\n'))
  atomicWrite(resolve(folder, '变更记录.md'), ['# AIRI 变更记录', '', '任务与说明由管理工具记录；源码文件状态见开发文档/current-changes.md。', '', ...data.events.toReversed().map(event => `- ${event.at} · ${event.taskId}: ${cell(event.note)}`), ''].join('\n'))
}

function git(...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
}

// Git supplies ignore rules. Stat polling also detects repeated edits to already-dirty files.
function sourceSignature() {
  const hash = createHash('sha256').update(git('rev-parse', 'HEAD'))
  const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort()
  for (const file of files) {
    try {
      const stat = statSync(resolve(repo, file))
      hash.update(`${file}\0${stat.size}\0${stat.mtimeMs}\0`)
    }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      hash.update(`${file}\0deleted\0`)
    }
  }
  for (const file of workspaceSourceFiles(workspace)) {
    const stat = statSync(resolve(workspace, file))
    hash.update(`${file}\0${stat.size}\0${stat.mtimeMs}\0`)
  }
  return hash.digest('hex')
}

function synchronize(force = false) {
  try {
    const signature = sourceSignature()
    if (force || signature !== syncState.signature) {
      execFileSync(process.execPath, [resolve(workspace, 'scripts/generate-project-index.mjs')], { cwd: workspace, windowsHide: true, timeout: 30000 })
      renderRecords(readData())
      syncState = { at: new Date().toISOString(), error: null, signature }
      atomicWrite(resolve(folder, 'sync-state.json'), JSON.stringify(syncState, null, 2) + '\n')
      console.log(`${syncState.at} source index synchronized`)
    }
  }
  catch (error) {
    syncState.error = error.message
    console.error(error)
  }
  return syncState
}

function requiredText(value, name, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new Error(`${name}不能为空，最多 ${maximum} 字。`)
  return value.trim()
}

function changeTask(input) {
  const data = readData()
  if (input.revision !== data.revision) throw new Error('任务已被更新，请刷新后重试。')
  const at = new Date().toISOString()
  let task
  let note
  if (input.action === 'add') {
    const number = Math.max(0, ...data.tasks.map(item => Number(item.id.slice(5)))) + 1
    task = { id: `AIRI-${String(number).padStart(3, '0')}`, title: requiredText(input.title, '任务标题', 160), status: 'todo', detail: requiredText(input.detail, '任务说明', 3000), updatedAt: at }
    data.tasks.push(task)
    note = `新增任务：${task.title}`
  }
  else if (input.action === 'update') {
    task = data.tasks.find(item => item.id === input.id)
    if (!task) throw new Error('任务不存在。')
    if (!Object.hasOwn(labels, input.status)) throw new Error('任务状态无效。')
    const summary = requiredText(input.note, '变更说明', 3000)
    note = `${labels[task.status]} → ${labels[input.status]}：${summary}`
    task.status = input.status
    task.title = requiredText(input.title, '任务标题', 160)
    task.detail = requiredText(input.detail, '任务说明', 3000)
    task.updatedAt = at
  }
  else throw new Error('不支持的操作。')
  data.revision++
  data.events.push({ at, taskId: task.id, note })
  atomicWrite(resolve(folder, 'tasks.backup.json'), readFileSync(dataPath, 'utf8'))
  atomicWrite(dataPath, JSON.stringify(data, null, 2) + '\n')
  renderRecords(data)
  synchronize(true)
  return data
}

async function readBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 24000) throw new Error('请求过大。')
    chunks.push(chunk)
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请求格式错误。')
  return input
}

mkdirSync(folder, { recursive: true })
const server = createServer(async (request, response) => {
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    response.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" })
    response.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  if (request.headers.host !== `127.0.0.1:${port}`) return send(403, { error: '只允许本机访问。' })
  const path = new URL(request.url, origin).pathname
  try {
    if (request.method === 'GET') {
      if (path === '/api/wiki') {
        const index = getWikiIndex()
        const query = new URL(request.url, origin).searchParams.get('q') ?? ''
        return send(200, { ...index, pages: findWikiTopics(query, index) })
      }
      if (path.startsWith('/api/wiki/page/')) {
        const page = readWikiPage(path.slice('/api/wiki/page/'.length))
        return page ? send(200, page) : send(404, { error: 'Wiki 专题不存在。' })
      }
      if (path.startsWith('/api/wiki/source/')) {
        const match = /^\/api\/wiki\/source\/([a-z0-9-]+)\/(\d+)$/.exec(path)
        const source = match ? readWikiSource(match[1], Number(match[2])) : undefined
        return source ? send(200, source) : send(404, { error: 'Wiki 来源不存在。' })
      }
      if (path === '/api/state') return send(200, { ...readData(), sync: syncState, csrf, documents: Object.entries(documents).map(([id, [name]]) => ({ id, name })) })
      if (path.startsWith('/documents/')) {
        const document = documents[path.slice('/documents/'.length)]
        if (document) return send(200, readFileSync(resolve(workspace, document[1]), 'utf8'), 'text/plain; charset=utf-8')
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/wiki.css': ['wiki.css', 'text/css'] }
      if (Object.hasOwn(assets, path)) {
        const [file, type] = assets[path]
        return send(200, readFileSync(resolve(workspace, 'scripts/project-manager-ui', file), 'utf8'), `${type}; charset=utf-8`)
      }
    }
    if (request.method === 'POST') {
      if (request.headers.origin !== origin || request.headers['x-project-token'] !== csrf) return send(403, { error: '请从本地管理页面提交操作。' })
      if (path === '/api/sync') return send(200, synchronize(true))
      if (path === '/api/tasks') return send(200, changeTask(await readBody(request)))
    }
    send(404, { error: '页面不存在。' })
  }
  catch (error) { send(400, { error: error.message }) }
})
server.on('error', error => { console.error(error); process.exitCode = 1 })
server.listen(port, '127.0.0.1', () => {
  synchronize(true)
  const timer = setInterval(() => synchronize(), 5000)
  timer.unref()
  console.log(`AIRI project manager: ${origin}`)
})
