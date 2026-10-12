import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = resolve(workspace, '.runtime')

async function fixture(run) {
  const folder = resolve(runtime, `wiki-tests-${randomUUID()}`)
  for (const path of ['scripts', 'wiki', 'airi', '项目管理']) mkdirSync(resolve(folder, path), { recursive: true })
  copyFileSync(resolve(workspace, 'scripts/project-wiki.mjs'), resolve(folder, 'scripts/project-wiki.mjs'))
  writeFileSync(resolve(folder, '项目管理/tasks.json'), JSON.stringify({ tasks: [{ id: 'AIRI-013' }] }))
  writeFileSync(resolve(folder, 'airi/model.py'), 'version = 1\n')
  const page = { id: 'vision', path: 'wiki/vision.md', title: '持续人脸识别', summary: '解释跳名与质量规则', tags: ['跳名', '人脸', '识别'], sources: ['airi/model.py'] }
  writeFileSync(resolve(folder, page.path), '# 持续识别\n\n[模型](../airi/model.py)\n')
  writeFileSync(resolve(folder, 'wiki/catalog.json'), JSON.stringify({ version: 1, pages: [page] }))
  const module = await import(pathToFileURL(resolve(folder, 'scripts/project-wiki.mjs')).href)
  const cli = (...args) => execFileSync(process.execPath, [resolve(folder, 'scripts/project-wiki.mjs'), ...args], { encoding: 'utf8', windowsHide: true })
  try { await run({ folder, page, module, cli }) }
  finally {
    if (dirname(folder) !== runtime || !folder.startsWith(resolve(runtime, 'wiki-tests-'))) throw new Error('拒绝清理异常测试目录。')
    rmSync(folder, { recursive: true, force: true })
  }
}

test('中文自然问题路由、空命中与单篇读取', () => fixture(({ module }) => {
  assert.equal(module.findWikiTopics('为什么认识的人会跳名')[0].id, 'vision')
  assert.deepEqual(module.findWikiTopics('不相关问题'), [])
  assert.match(module.readWikiPage('vision').markdown, /持续识别/)
  assert.equal(module.readWikiPage('missing'), undefined)
}))

test('源码、正文和条目变化使人工核对失效，sync 不刷新基线', () => fixture(({ folder, page, module, cli }) => {
  assert.equal(module.getWikiIndex().pages[0].status, 'unreviewed')
  cli('review', 'vision', '--task', 'AIRI-013', '--note', '人工核对测试来源')
  assert.equal(module.getWikiIndex().pages[0].status, 'current')
  writeFileSync(resolve(folder, 'airi/model.py'), 'version = 2\n')
  module.syncWikiIndex()
  assert.equal(module.getWikiIndex().pages[0].status, 'stale')
  assert.deepEqual(module.getWikiIndex().pages[0].changed, ['airi/model.py'])
  assert.throws(() => cli('check'))
  cli('review', 'vision', '--task', 'AIRI-013', '--note', '再次人工核对')
  writeFileSync(resolve(folder, page.path), '# 更改正文\n')
  assert.ok(module.getWikiIndex().pages[0].changed.includes(page.path))
  cli('review', 'vision', '--task', 'AIRI-013', '--note', '核对正文')
  page.tags.push('新版')
  writeFileSync(resolve(folder, 'wiki/catalog.json'), JSON.stringify({ version: 1, pages: [page] }))
  assert.ok(module.getWikiIndex().pages[0].changed.includes('catalog'))
}))

test('删除来源、断链和未登记文章都被报告', () => fixture(({ folder, page, module }) => {
  rmSync(resolve(folder, 'airi/model.py'))
  writeFileSync(resolve(folder, page.path), '# 文档\n[坏链接](missing.md)\n')
  writeFileSync(resolve(folder, 'wiki/unlisted.md'), '# 未登记\n')
  const errors = module.getWikiIndex().errors
  assert.ok(errors.some(error => error.includes('来源或文章不存在')))
  assert.ok(errors.some(error => error.includes('链接不存在')))
  assert.ok(errors.some(error => error.includes('未进入 catalog')))
}))

test('review 需要存在的任务和说明，不接受省略参数', () => fixture(({ cli }) => {
  assert.throws(() => cli('review', 'vision', '--task', 'AIRI-013'))
  assert.throws(() => cli('review', 'vision', '--task', 'AIRI-999', '--note', '核对'))
  assert.throws(() => cli('review', 'vision', '--note', '核对'))
}))

test('catalog 来源拒绝私人路径与工作区外路径', () => fixture(({ folder, page, module }) => {
  for (const source of ['airi/.local/realtime-voice.json', 'airi/../../outside.py', 'airi/node_modules/example.ts']) {
    page.sources = [source]
    writeFileSync(resolve(folder, 'wiki/catalog.json'), JSON.stringify({ version: 1, pages: [page] }))
    assert.throws(() => module.readWikiCatalog())
  }
}))

test('来源读取仅支持已登记的专题与来源序号', () => fixture(({ module }) => {
  assert.match(module.readWikiSource('vision', 0).text, /version = 1/)
  assert.equal(module.readWikiSource('../vision', 0), undefined)
  assert.equal(module.readWikiSource('vision', -1), undefined)
  assert.equal(module.readWikiSource('vision', 99), undefined)
}))

test('检索最多返回五篇，目录仍可列出全部', () => fixture(({ folder, page, module }) => {
  const pages = Array.from({ length: 7 }, (_, index) => ({ ...page, id: `vision-${index}`, path: `wiki/vision-${index}.md` }))
  for (const item of pages) writeFileSync(resolve(folder, item.path), '# 识别\n')
  rmSync(resolve(folder, page.path))
  writeFileSync(resolve(folder, 'wiki/catalog.json'), JSON.stringify({ version: 1, pages }))
  assert.equal(module.findWikiTopics('人脸识别').length, 5)
  assert.equal(module.findWikiTopics('').length, 7)
  module.syncWikiIndex()
  const index = JSON.parse(readFileSync(resolve(folder, 'wiki/index.json'), 'utf8'))
  assert.equal(index.pages.length, 7)
}))
