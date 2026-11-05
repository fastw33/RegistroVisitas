const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { randomBytes } = require('node:crypto')

const script = fs.readFileSync(path.join(__dirname, '../scripts/setup.js'), 'utf8')
function setup({ exists = false, template = 'JWT_SECRET=\r\nADMIN_PASSWORD=\r\nAWS_SECRET_ACCESS_KEY=\r\n' } = {}) {
  const writes = []
  const files = {
    existsSync: () => exists,
    readFileSync: () => { assert.equal(exists, false); return template },
    writeFileSync: (file, content, options) => writes.push({ file, content, options }),
  }
  vm.runInNewContext(script, {
    __dirname: path.join(__dirname, '../scripts'),
    require(name) {
      if (name === 'node:fs') return files
      if (name === 'node:path') return path
      if (name === 'node:crypto') return { randomBytes }
      throw new Error(`Módulo inesperado: ${name}`)
    },
    console: { log() {} },
  })
  return writes
}

test('setup genera una clave aleatoria por entorno desde la plantilla vacía, sin tocar disco', () => {
  const [first] = setup(), [second] = setup()
  const secret = first.content.match(/^JWT_SECRET=([a-f0-9]{96})\r?$/m)?.[1]
  assert.ok(secret)
  assert.ok(!second.content.includes(secret))
  assert.ok(first.content.includes('ADMIN_PASSWORD=\r\nAWS_SECRET_ACCESS_KEY=\r\n'))
  assert.equal(first.options.flag, 'wx')
  assert.equal(first.options.mode, 0o600)
})

test('setup conserva un entorno existente y rechaza una plantilla sin campo JWT', () => {
  assert.equal(setup({ exists: true }).length, 0)
  assert.throws(() => setup({ template: 'PORT=3015\n' }), /no define JWT_SECRET/)
})
