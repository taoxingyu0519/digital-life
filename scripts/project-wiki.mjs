import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wikiFolder = resolve(workspace, 'wiki')
const evidencePath = resolve(wikiFolder, 'evidence.json')
const labels = { current: '已核对', stale: '待复核', unreviewed: '未核对' }
const hash = text => createHash('sha256').update(text).digest('hex')
const normalize = text => text.replaceAll('\\', '/')

function publicPath(path) {
  if (typeof path !== 'string' || !/^(wiki|airi|scripts|开发文档|项目管理)\//.test(path) && path !== 'AGENTS.md')
    throw new Error(`来源不在项目公开目录：${path}`)
  if (/(^|\/)(\.[^/]+|node_modules|models|photos|templates)(\/|$)/.test(path) && !path.startsWith('wiki/templates/'))
    throw new Error(`来源不能包含私人或依赖目录：${path}`)
  if (!['.md', '.ts', '.vue', '.py', '.js', '.mjs', '.ps1', '.json', '.yaml', '.css', '.html', '.txt'].includes(extname(path)))
    throw new Error(`来源不是支持的文本文件：${path}`)
  const absolute = resolve(workspace, path)
  const resolved = existsSync(absolute) ? realpathSync(absolute) : absolute
  const within = relative(realpathSync(workspace), resolved)
  if (within.startsWith(`..${sep}`) || within === '..' || resolve(resolved) === workspace)
    throw new Error(`路径越过工作区：${path}`)
  return absolute
}

export function readWikiCatalog() {
  const catalog = JSON.parse(readFileSync(resolve(wikiFolder, 'catalog.json'), 'utf8'))
  if (catalog.version !== 1 || !Array.isArray(catalog.pages)) throw new Error('Wiki catalog 格式错误。')
  const ids = new Set()
  const paths = new Set()
  for (const page of catalog.pages) {
    if (!/^[a-z0-9-]+$/.test(page.id) || ids.has(page.id) || typeof page.path !== 'string'
      || !page.path.startsWith('wiki/') || !page.path.endsWith('.md') || paths.has(page.path)
      || typeof page.title !== 'string' || !page.title.trim() || typeof page.summary !== 'string' || !page.summary.trim()
      || !Array.isArray(page.tags) || !page.tags.length || page.tags.some(tag => typeof tag !== 'string' || !tag)
      || !Array.isArray(page.sources) || !page.sources.length || new Set(page.sources).size !== page.sources.length)
      throw new Error(`Wiki 专题格式错误或重复：${page.id}`)
    publicPath(page.path)
    for (const source of page.sources) publicPath(source)
    ids.add(page.id)
    paths.add(page.path)
  }
  return catalog
}

function writeOutput(path, value) {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, path)
}

function readEvidence() {
  if (!existsSync(evidencePath)) return { version: 1, pages: {} }
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  if (evidence.version !== 1 || !evidence.pages || typeof evidence.pages !== 'object' || Array.isArray(evidence.pages))
    throw new Error('Wiki evidence 格式错误。')
  return evidence
}

function snapshot(page) {
  const fingerprints = { catalog: hash(JSON.stringify(page)) }
  for (const path of [page.path, ...page.sources]) {
    const absolute = publicPath(path)
    fingerprints[path] = existsSync(absolute) && statSync(absolute).isFile() ? hash(readFileSync(absolute)) : null
  }
  return fingerprints
}

function localLinks(page, errors) {
  const absolute = publicPath(page.path)
  if (!existsSync(absolute)) return
  const content = readFileSync(absolute, 'utf8')
  // Fenced examples are data, not document navigation.
  const prose = content.replace(/```[^\n]*\n[\s\S]*?```/g, '')
  for (const match of prose.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const path = decodeURIComponent(target.split('#')[0])
    const destination = normalize(relative(workspace, resolve(dirname(absolute), path)))
    try {
      if (!existsSync(publicPath(destination))) errors.push(`${page.id} 的链接不存在：${target}`)
    }
    catch (error) { errors.push(`${page.id} 的链接无效：${error.message}`) }
  }
}

export function getWikiIndex() {
  const catalog = readWikiCatalog()
  const evidence = readEvidence()
  const errors = []
  const pages = catalog.pages.map(page => {
    const fingerprints = snapshot(page)
    const baseline = evidence.pages[page.id]
    const changed = baseline ? [...new Set([...Object.keys(fingerprints), ...Object.keys(baseline.fingerprints ?? {})])]
      .filter(path => fingerprints[path] !== baseline.fingerprints?.[path]) : Object.keys(fingerprints)
    for (const [path, value] of Object.entries(fingerprints)) {
      if (value === null) errors.push(`${page.id} 的来源或文章不存在：${path}`)
    }
    localLinks(page, errors)
    return { ...page, status: !baseline ? 'unreviewed' : changed.length ? 'stale' : 'current', changed,
      reviewedAt: baseline?.at ?? null, task: baseline?.task ?? null }
  })
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() && entry.name.endsWith('.md') && absolute !== resolve(wikiFolder, 'index.md')) {
        const path = normalize(relative(workspace, absolute))
        if (!pages.some(page => page.path === path)) errors.push(`文章未进入 catalog：${path}`)
      }
    }
  }
  visit(wikiFolder)
  return { version: 1, pages, errors }
}

export function syncWikiIndex() {
  const index = getWikiIndex()
  writeOutput(resolve(wikiFolder, 'index.json'), index)
  const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
  writeOutput(resolve(wikiFolder, 'index.md'), [
    '# Wiki 目录与证据状态', '', '由目录同步生成。已核对表示文件指纹与人工核对记录一致，不表示功能验收通过。', '',
    '| 专题 | 摘要 | 证据状态 | 核对时间 |', '| --- | --- | --- | --- |',
    ...index.pages.map(page => `| [${cell(page.title)}](${page.path.slice(5)}) | ${cell(page.summary)} | ${labels[page.status]} | ${page.reviewedAt ?? '未核对'} |`), '',
    ...index.pages.filter(page => page.status !== 'current').map(page => `- ${page.id}：${page.changed.join('、')}`),
    ...index.errors.map(error => `- 错误：${error}`), '', '返回 [Wiki 首页](README.md)。', '',
  ].join('\n'))
  return index
}

export function findWikiTopics(query, index = getWikiIndex()) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return index.pages
  const words = normalized.split(/[\s，。？?、,]+/u).filter(Boolean)
  return index.pages.map(page => {
    const text = `${page.title} ${page.summary} ${page.tags.join(' ')}`.toLowerCase()
    const score = page.tags.reduce((sum, tag) => sum + (normalized.includes(tag.toLowerCase()) ? 4 : 0), 0)
      + words.reduce((sum, word) => sum + (text.includes(word) ? 2 : 0), 0)
    return { ...page, score }
  }).filter(page => page.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
}

export function readWikiPage(id) {
  const page = getWikiIndex().pages.find(page => page.id === id)
  if (!page) return undefined
  return { ...page, markdown: readFileSync(publicPath(page.path), 'utf8') }
}

export function readWikiSource(id, sourceIndex) {
  const page = readWikiCatalog().pages.find(page => page.id === id)
  if (!page || !Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= page.sources.length) return undefined
  const path = page.sources[sourceIndex]
  return { path, text: readFileSync(publicPath(path), 'utf8') }
}

function reviewPage(id, task, note) {
  if (!/^AIRI-\d+$/.test(task ?? '') || !note?.trim()) throw new Error('review 必须提供 --task AIRI-编号 和 --note 人工核对说明。')
  const tasks = JSON.parse(readFileSync(resolve(workspace, '项目管理/tasks.json'), 'utf8')).tasks
  if (!tasks.some(item => item.id === task)) throw new Error('核对任务不存在。')
  const index = getWikiIndex()
  const page = index.pages.find(page => page.id === id)
  if (!page) throw new Error(`专题不存在：${id}`)
  if (index.errors.length) throw new Error(index.errors.join('\n'))
  const evidence = readEvidence()
  const catalogPage = readWikiCatalog().pages.find(item => item.id === id)
  evidence.pages[id] = { at: new Date().toISOString(), task, note: note.trim(), fingerprints: snapshot(catalogPage) }
  writeOutput(evidencePath, evidence)
  syncWikiIndex()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command = 'check', ...args] = process.argv.slice(2)
    if (command === 'find') {
      console.log(JSON.stringify(findWikiTopics(args.join(' ')).map(({ id, path, summary, status, changed }) => ({ id, path, summary, status, changed })), null, 2))
    }
    else if (command === 'show') {
      const page = readWikiPage(args[0])
      if (!page) throw new Error(`专题不存在：${args[0]}`)
      console.log(`${labels[page.status]} · ${page.path}\n\n${page.markdown}`)
    }
    else if (command === 'review') {
      const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
      reviewPage(args[0], option('--task'), option('--note'))
      console.log(`已记录 ${args[0]} 的人工核对。`)
    }
    else if (command === 'check' || command === 'sync') {
      const index = syncWikiIndex()
      const stale = index.pages.filter(page => page.status !== 'current').map(page => ({ id: page.id, status: page.status, changed: page.changed }))
      console.log(JSON.stringify({ pages: index.pages.length, current: index.pages.length - stale.length, pending: stale, errors: index.errors }, null, 2))
      if (command === 'check' && (stale.length || index.errors.length)) process.exitCode = 1
      if (command === 'sync' && index.errors.length) process.exitCode = 1
    }
    else throw new Error('命令：find <问题>、show <id>、check、sync、review <id> --task <任务> --note <说明>。')
  }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
