import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/** Lists local tooling and hand-maintained documents, excluding generated outputs. */
export function workspaceSourceFiles(workspace) {
  const files = []
  function visit(directory) {
    for (const entry of readdirSync(resolve(workspace, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  visit('scripts')
  if (readdirSync(workspace).includes('wiki')) {
    const generated = new Set(['wiki/index.md', 'wiki/index.json'])
    const before = files.length
    visit('wiki')
    files.splice(before, files.length - before, ...files.slice(before).filter(path => !generated.has(path)))
  }
  for (const entry of readdirSync(workspace, { withFileTypes: true })) {
    if (entry.isFile() && /\.(md|cmd)$/i.test(entry.name)) files.push(entry.name)
  }
  for (const entry of readdirSync(resolve(workspace, '开发文档'), { withFileTypes: true })) {
    if (entry.isFile() && /^\d+-.*\.md$/.test(entry.name) && entry.name !== '03-workspace-index.md')
      files.push(`开发文档/${entry.name}`)
  }
  files.push('项目管理/tasks.json')
  return files.sort()
}
