import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { workspaceSourceFiles } from './workspace-source-files.mjs'
import { syncWikiIndex } from './project-wiki.mjs'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(workspace, 'airi')
const output = resolve(workspace, '开发文档')
mkdirSync(output, { recursive: true })
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
const trackedFiles = git('ls-files', '-z').split('\0').filter(Boolean)
const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))]
  .filter(path => existsSync(resolve(repo, path))).sort()
const commit = git('rev-parse', 'HEAD').trim()
const changedFiles = git('status', '--short', '--untracked-files=all').trimEnd()
function writeOutput(name, content) {
  const path = resolve(output, name)
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, path)
}
const allowed = /^(apps|packages|plugins|integrations|services|engines|server|docs)\//
const manifests = files.filter(path => path.endsWith('/package.json') && allowed.test(path))
const packages = manifests.map(path => {
  const value = JSON.parse(readFileSync(resolve(repo, path), 'utf8'))
  return {
    path: path.slice(0, -'/package.json'.length), name: value.name,
    description: value.description ?? '', version: value.version,
    scripts: value.scripts ?? {}, exports: value.exports,
    dependencies: value.dependencies ?? {}, devDependencies: value.devDependencies ?? {},
  }
}).filter(pkg => pkg.name).sort((a, b) => a.path.localeCompare(b.path))
const names = new Set(packages.map(pkg => pkg.name))
for (const pkg of packages) {
  pkg.workspaceDependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(name => names.has(name)).sort()
}
writeOutput('workspace-index.json', JSON.stringify({ commit, trackedFileCount: trackedFiles.length, sourceFileCount: files.length, packages }, null, 2) + '\n')
const escapeCell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
const rows = packages.map(pkg => `| [${pkg.path}](../airi/${pkg.path}/package.json) | ${pkg.name} | ${escapeCell(pkg.description)} | ${Object.keys(pkg.scripts).join(', ')} |`)
writeOutput('03-workspace-index.md', [
  '# 工作区包索引', '', `基准提交：\`${commit}\`。`, '',
  `由当前工作目录生成，包含未提交的新文件，排除已删除文件和 Git 忽略文件。含 ${packages.length} 个具名包，不含仓库根包。`,
  '目录不一定都是可独立启动的应用。脚本和依赖以对应 package.json 为准。', '',
  '| 目录 | 包名 | 上游说明 | 可用脚本 |', '| --- | --- | --- | --- |', ...rows, '',
  '完整脚本、包导出与内部依赖见 [workspace-index.json](workspace-index.json)。', '',
  '重新生成：在工作区运行 `node scripts/generate-project-index.mjs`。', '',
].join('\n'))
const directories = new Map()
for (const path of files) {
  const parts = path.split('/')
  for (let depth = 1; depth < parts.length && depth <= 3; depth++) {
    const key = parts.slice(0, depth).join('/')
    directories.set(key, (directories.get(key) ?? 0) + 1)
  }
}
const tree = [...directories].sort(([a], [b]) => a.localeCompare(b)).map(([path, count]) => `${'  '.repeat(path.split('/').length - 1)}${path.split('/').at(-1)}/ (${count} source files)`)
writeOutput('source-directory-tree.txt', [`AIRI @ ${commit}`, 'Current source tree, depth 3. Includes untracked source; excludes deleted and ignored files. Counts include descendants.', ...tree, ''].join('\n'))
writeOutput('tracked-source-files.txt', trackedFiles.join('\n') + '\n')
writeOutput('source-files.txt', files.join('\n') + '\n')
const workspaceFiles = [...workspaceSourceFiles(workspace), ...files.map(path => `airi/${path}`)].sort()
writeOutput('workspace-source-files.txt', workspaceFiles.join('\n') + '\n')
writeOutput('current-changes.md', ['# 当前源码改动', '', '基准提交：`' + commit + '`。由目录同步工具生成；功能说明请维护变更记录与架构文档。', '', '```text', changedFiles || '(工作目录干净)', '```', ''].join('\n'))
const wiki = syncWikiIndex()
if (wiki.errors.length) throw new Error(wiki.errors.join('\n'))
console.log(JSON.stringify({ commit, packages: packages.length, trackedFiles: trackedFiles.length, sourceFiles: files.length, output: relative(workspace, output) }))
