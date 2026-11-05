const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.join(__dirname, '..')
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    if (['node_modules', 'storage', '.git', '.test-mongo', '.local'].includes(entry.name)) return []
    return entry.isDirectory() ? walk(file) : file.endsWith('.js') ? [file] : []
  })
}
const files = walk(root)
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1) }
}
console.log(`${files.length} archivos JavaScript sin errores de sintaxis`)
