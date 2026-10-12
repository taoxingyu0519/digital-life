const $ = id => document.getElementById(id)
const labels = { todo: '待办', doing: '进行中', done: '已完成', blocked: '待处理' }
let state
let editingId
let editingRevision
let wikiPages = []
let wikiSearchGeneration = 0
let wikiPageGeneration = 0
const wikiLabels = { current: '已核对', stale: '待复核', unreviewed: '未核对' }
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'
function element(tag, text, className) {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}
async function request(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Project-Token': state.csrf }, body: JSON.stringify(body) } : {})
  const result = await response.json()
  if (!response.ok || result.error) throw new Error(result.error || `请求失败：${response.status}`)
  return result
}
function render() {
  $('sync-title').textContent = state.sync.error ? '目录同步需要处理' : '目录自动同步已启用'
  $('sync-detail').textContent = state.sync.error || `最近同步：${date(state.sync.at)} · 每 5 秒检查源码变化`
  $('sync-title').classList.toggle('error', Boolean(state.sync.error))
  $('task-count').textContent = `${state.tasks.length}`
  $('board').replaceChildren()
  const query = $('search').value.trim().toLowerCase()
  for (const [status, label] of Object.entries(labels)) {
    const tasks = state.tasks.filter(task => task.status === status && `${task.id} ${task.title} ${task.detail}`.toLowerCase().includes(query))
    const column = element('div', undefined, `column ${status}`)
    column.append(element('h3', `${label} · ${tasks.length}`))
    for (const task of tasks) {
      const card = element('button', undefined, 'card')
      card.append(element('span', task.id, 'task-id'), element('strong', task.title), element('p', task.detail), element('small', date(task.updatedAt)))
      card.addEventListener('click', () => openEditor(task))
      column.append(card)
    }
    if (!tasks.length) column.append(element('p', '暂无任务', 'empty'))
    $('board').append(column)
  }
  $('documents').replaceChildren(...state.documents.map(document => {
    const link = element('a', `${document.name} ↗`)
    link.href = `/documents/${document.id}`
    link.target = '_blank'
    link.rel = 'noopener'
    return link
  }))
  $('events').replaceChildren(...state.events.slice(-10).reverse().map(event => {
    const row = element('li')
    row.append(element('small', `${date(event.at)} · ${event.taskId}`), element('p', event.note))
    return row
  }))
}
async function refresh() {
  state = await request('/api/state')
  render()
}
function openEditor(task) {
  editingId = task?.id
  editingRevision = state.revision
  $('editor-title').textContent = task ? `编辑 ${task.id}` : '新建任务'
  $('title').value = task?.title || ''
  $('detail').value = task?.detail || ''
  $('status').value = task?.status || 'todo'
  $('note').value = ''
  $('note').required = Boolean(task)
  $('status-label').hidden = !task
  $('note-label').hidden = !task
  $('form-error').textContent = ''
  $('editor').showModal()
}
$('add-button').addEventListener('click', () => { if (state) openEditor() })
$('cancel-button').addEventListener('click', () => $('editor').close())
$('search').addEventListener('input', () => { if (state) render() })
$('sync-button').addEventListener('click', async () => {
  $('sync-button').disabled = true
  try { await request('/api/sync', {}); await refresh(); $('message').textContent = '源码目录和任务文档已同步。' }
  catch (error) { $('message').textContent = error.message }
  finally { $('sync-button').disabled = false }
})
$('task-form').addEventListener('submit', async event => {
  event.preventDefault()
  $('save-button').disabled = true
  try {
    await request('/api/tasks', { action: editingId ? 'update' : 'add', id: editingId, title: $('title').value, detail: $('detail').value, status: $('status').value, note: $('note').value, revision: editingRevision })
    $('editor').close()
    await refresh()
    $('message').textContent = '任务已保存，变更记录和目录已同步。'
  }
  catch (error) { $('form-error').textContent = error.message }
  finally { $('save-button').disabled = false }
})
refresh().catch(error => { $('message').textContent = error.message })
setInterval(() => refresh().catch(error => { $('message').textContent = `连接中断：${error.message}。请重新启动项目管理工具。` }), 10000)

function wikiInline(container, text, page) {
  let at = 0
  for (const match of text.matchAll(/`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g)) {
    container.append(document.createTextNode(text.slice(at, match.index)))
    if (match[1]) container.append(element('code', match[1]))
    else {
      const link = element('a', match[2])
      const target = match[3]
      const destination = new URL(target, `${location.origin}/${page.path}`)
      const local = wikiPages.find(item => `/${item.path}` === destination.pathname)
      if (destination.origin === location.origin && local) link.href = `#wiki/${local.id}`
      else if (destination.origin === location.origin && destination.pathname === '/wiki/index.md') {
        link.href = '/documents/wiki-index'
        link.target = '_blank'
        link.rel = 'noopener'
      }
      else if (/^https?:\/\//.test(target)) {
        link.href = target
        link.target = '_blank'
        link.rel = 'noopener'
      }
      else {
        const owner = wikiPages.find(item => item.sources.some(source => `/${source}` === destination.pathname))
        if (owner) {
          const sourceIndex = owner.sources.findIndex(source => `/${source}` === destination.pathname)
          link.href = `/api/wiki/source/${owner.id}/${sourceIndex}`
          link.addEventListener('click', async event => {
            event.preventDefault()
            const generation = ++wikiPageGeneration
            try {
              const source = await request(link.getAttribute('href'))
              if (generation !== wikiPageGeneration) return
              const back = element('button', '返回专题')
              back.addEventListener('click', () => openWikiPage(page.id))
              $('wiki-article').replaceChildren(back, element('h3', source.path), element('pre', source.text, 'wiki-source'))
            }
            catch (error) { $('wiki-message').textContent = error.message }
          })
        }
        else {
          link.title = destination.pathname.slice(1)
          link.className = 'wiki-file-label'
        }
      }
      container.append(link)
    }
    at = match.index + match[0].length
  }
  container.append(document.createTextNode(text.slice(at)))
}

function wikiMarkdown(page) {
  const fragment = document.createDocumentFragment()
  const lines = page.markdown.split('\n')
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }
    if (line.startsWith('```')) {
      const language = line.slice(3)
      const code = []
      while (++index < lines.length && !lines[index].startsWith('```')) code.push(lines[index])
      if (language === 'mermaid') fragment.append(element('p', '数据流图的文本定义，可在 Markdown 编辑器中查看图形。', 'muted'))
      fragment.append(element('pre', code.join('\n')))
      index++
      continue
    }
    if (line.startsWith('|')) {
      const table = element('table')
      let header = true
      while (index < lines.length && lines[index].startsWith('|')) {
        const cells = lines[index++].slice(1, -1).split('|').map(cell => cell.trim())
        if (cells.every(cell => /^:?-+:?$/.test(cell))) continue
        const row = element('tr')
        for (const text of cells) {
          const cell = element(header ? 'th' : 'td')
          if (header) cell.scope = 'col'
          wikiInline(cell, text, page)
          row.append(cell)
        }
        table.append(row)
        header = false
      }
      const wrapper = element('div', undefined, 'wiki-table')
      wrapper.append(table)
      fragment.append(wrapper)
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      fragment.append(element(`h${Math.min(heading[1].length + 1, 4)}`, heading[2]))
      index++
      continue
    }
    const list = /^(?:- |\d+\. )/.test(line)
    if (list) {
      const container = element(line.startsWith('- ') ? 'ul' : 'ol')
      while (index < lines.length && /^(?:- |\d+\. )/.test(lines[index])) {
        const item = element('li')
        wikiInline(item, lines[index++].replace(/^(?:- |\d+\. )/, ''), page)
        container.append(item)
      }
      fragment.append(container)
      continue
    }
    const text = []
    while (index < lines.length && lines[index].trim() && !/^(?:#|\||```|- |\d+\. )/.test(lines[index])) text.push(lines[index++])
    if (!text.length) text.push(lines[index++])
    const paragraph = element('p')
    wikiInline(paragraph, text.join(' '), page)
    fragment.append(paragraph)
  }
  return fragment
}

async function loadWikiTopics(query = '') {
  const generation = ++wikiSearchGeneration
  const result = await request(`/api/wiki?q=${encodeURIComponent(query)}`)
  if (generation !== wikiSearchGeneration) return
  $('wiki-message').textContent = result.errors.length ? result.errors.join('；') : query ? `找到 ${result.pages.length} 篇专题` : `共 ${result.pages.length} 篇专题`
  $('wiki-topics').replaceChildren(...result.pages.map(page => {
    const link = element('a', undefined, 'wiki-topic')
    link.href = `#wiki/${page.id}`
    link.append(element('strong', page.title), element('span', page.summary), element('small', wikiLabels[page.status]))
    return link
  }))
}

async function openWikiPage(id) {
  const generation = ++wikiPageGeneration
  const page = await request(`/api/wiki/page/${encodeURIComponent(id)}`)
  if (generation !== wikiPageGeneration) return
  const status = element('p', `${wikiLabels[page.status]} · ${page.reviewedAt ? date(page.reviewedAt) : '尚无人工核对记录'}`, 'wiki-status')
  if (page.status !== 'current') status.append(element('span', ` · 需核对：${page.changed.join('、')}`))
  $('wiki-article').replaceChildren(status, wikiMarkdown(page))
  $('wiki-article').scrollTop = 0
}

function openWikiHash() {
  const id = /^#wiki\/([a-z0-9-]+)$/.exec(location.hash)?.[1]
  if (id) {
    $('wiki-heading').scrollIntoView({ block: 'start' })
    openWikiPage(id).catch(error => { $('wiki-message').textContent = error.message })
  }
}
$('wiki-search-form').addEventListener('submit', event => {
  event.preventDefault()
  loadWikiTopics($('wiki-search').value).catch(error => { $('wiki-message').textContent = error.message })
})
$('wiki-all').addEventListener('click', () => {
  $('wiki-search').value = ''
  loadWikiTopics().catch(error => { $('wiki-message').textContent = error.message })
})
window.addEventListener('hashchange', openWikiHash)
request('/api/wiki').then(async index => {
  wikiPages = index.pages
  await loadWikiTopics()
  openWikiHash()
}).catch(error => { $('wiki-message').textContent = error.message })
