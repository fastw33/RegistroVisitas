const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const root = path.resolve(__dirname, '..')
const source = dotenv.parse(fs.readFileSync(path.join(root, '../wmsBack/.env')))
const target = path.join(root, '.env')
if (!source.JWT_SECRET?.trim()) throw new Error('WMS debe tener un JWT_SECRET configurado')
const updates = { AUTH_MODE: 'both', WMS_JWT_SECRET: source.JWT_SECRET, WMS_JWT_SUBJECT_CLAIM: 'id_usuario', WMS_AUTO_PROVISION: 'true' }
const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/)
for (const [key, value] of Object.entries(updates)) {
  if (/['\r\n]/.test(value)) throw new Error('Valor de configuración no compatible con la importación')
  const line = `${key}='${value}'`
  const index = lines.findIndex(existing => existing.startsWith(`${key}=`))
  if (index < 0) lines.push(line); else lines[index] = line
}
fs.writeFileSync(target, lines.join('\n'), { mode: 0o600 })
console.log('WMS habilitado con validación de firma y permisos específicos de visitas. No se mostraron secretos ni se modificó WMS.')
