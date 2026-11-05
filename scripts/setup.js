const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const target = path.join(__dirname, '../.env')
if (fs.existsSync(target)) {
  console.log('.env ya existe; no se modificó.')
} else {
  const template = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8')
  if (!/^JWT_SECRET=/m.test(template)) throw new Error('La plantilla no define JWT_SECRET; no se creó .env.')
  const configured = template.replace(/^JWT_SECRET=[^\r\n]*/m, `JWT_SECRET=${randomBytes(48).toString('hex')}`)
  fs.writeFileSync(target, configured, { flag: 'wx', mode: 0o600 })
  console.log('.env creado con una clave JWT aleatoria. Configure MongoDB, privacidad y el administrador.')
}
