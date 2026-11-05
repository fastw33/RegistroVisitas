const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const root = path.resolve(__dirname, '..')
const sourceIndex = process.argv.indexOf('--source')
const sourcePath = sourceIndex >= 0 ? path.resolve(process.argv[sourceIndex + 1]) : path.join(root, '../GestorDocumental/.env')
const targetPath = path.join(root, '.env')
const source = dotenv.parse(fs.readFileSync(sourcePath))
const original = fs.readFileSync(targetPath, 'utf8')
const current = dotenv.parse(original)
const keys = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'S3_BUCKET', 'S3_ENDPOINT', 'S3_FORCE_PATH_STYLE', 'S3_PREFIX']
const values = {
  AWS_REGION: source.AWS_REGION || source.S3_REGION || '',
  AWS_ACCESS_KEY_ID: source.AWS_ACCESS_KEY_ID || '', AWS_SECRET_ACCESS_KEY: source.AWS_SECRET_ACCESS_KEY || '',
  AWS_SESSION_TOKEN: source.AWS_SESSION_TOKEN || '', S3_BUCKET: 'registro-de-visitas',
  S3_ENDPOINT: source.S3_ENDPOINT || '', S3_FORCE_PATH_STYLE: source.S3_FORCE_PATH_STYLE || 'false',
  S3_PREFIX: 'registro-visitas',
}
if (!values.S3_BUCKET || !values.AWS_REGION) throw new Error('GestorDocumental debe tener S3_BUCKET y AWS_REGION configurados')
const replace = process.argv.includes('--replace-s3')
function encode(value) {
  const text = String(value)
  if (!/['\r\n]/.test(text)) return `'${text}'`
  throw new Error('Una variable de origen contiene comillas simples o saltos de línea no compatibles con esta importación')
}
const update = {}
for (const key of keys) if (replace || !current[key]) update[key] = values[key]
const lines = original.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?STORAGE_DIR\s*=/.test(line))
for (const [key, value] of Object.entries(update)) {
  const line = `${key}=${encode(value)}`
  const index = lines.findIndex(existing => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(existing))
  if (index >= 0) lines[index] = line
  else lines.push(line)
}
fs.writeFileSync(targetPath, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 })
console.log('Configuración S3 importada de GestorDocumental, con prefijo propio registro-visitas. No se mostraron secretos, no se modificó MongoDB/JWT ni se contactó S3.')
