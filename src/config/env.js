require('dotenv').config({ quiet: true })

function integer(name, fallback, min = 0, max = 65535) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} inválido`)
  return value
}
const secret = process.env.JWT_SECRET || ''
if (secret.length < 32 || /REEMPLAZAR/i.test(secret)) throw new Error('Configure JWT_SECRET con al menos 32 caracteres aleatorios')
const authMode = process.env.AUTH_MODE || 'local'
if (!['local', 'wms', 'both'].includes(authMode)) throw new Error('AUTH_MODE inválido')
// WMS puede tener una clave legada de otra longitud. Validar su firma con la
// misma clave no exige rotar todas sus sesiones. La clave local sí exige 32 caracteres.
if (authMode !== 'local' && !(process.env.WMS_JWT_SECRET || '').trim()) throw new Error('Configure WMS_JWT_SECRET para autenticación WMS')
const s3Prefix = (process.env.S3_PREFIX || 'registro-visitas').replace(/\/+$/, '')
if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(s3Prefix)) throw new Error('S3_PREFIX inválido')
const s3Endpoint = process.env.S3_ENDPOINT || ''
if (s3Endpoint) {
  const url = new URL(s3Endpoint)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('S3_ENDPOINT inválido')
}

module.exports = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: integer('PORT', 3015, 1), host: process.env.HOST || '0.0.0.0',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27019/registro_visitas?replicaSet=rs0&directConnection=true',
  jwtSecret: secret, jwtIssuer: process.env.JWT_ISSUER || 'registro-visitas',
  jwtAudience: process.env.JWT_AUDIENCE || 'registro-visitas-api', jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  authMode, wmsSecret: process.env.WMS_JWT_SECRET,
  wmsAutoProvision: process.env.WMS_AUTO_PROVISION === 'true',
  wmsSubjectClaim: process.env.WMS_JWT_SUBJECT_CLAIM || 'id_usuario',
  wmsIssuer: process.env.WMS_JWT_ISSUER || undefined, wmsAudience: process.env.WMS_JWT_AUDIENCE || undefined,
  origins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(v => v.trim()).filter(Boolean),
  trustProxy: integer('TRUST_PROXY', 0, 0, 10),
  s3: Object.freeze({
    region: process.env.AWS_REGION || process.env.S3_REGION || '',
    bucket: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || '',
    prefix: s3Prefix, endpoint: s3Endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    maxBytes: 20 * 1024 * 1024,
  }),
  maxUploadBytes: integer('MAX_UPLOAD_MB', 5, 1, 20) * 1024 * 1024,
  photo: Object.freeze({
    concurrency: integer('PHOTO_MAX_CONCURRENT', 1, 1, 4),
    facePixels: integer('PHOTO_FACE_MAX_PX', 720, 320, 1200),
    documentPixels: integer('PHOTO_DOCUMENT_MAX_PX', 1440, 1024, 2000),
    faceQuality: integer('PHOTO_FACE_QUALITY', 60, 45, 85),
    documentQuality: integer('PHOTO_DOCUMENT_QUALITY', 72, 60, 90),
    maxBytes: integer('PHOTO_MAX_OUTPUT_KB', 256, 128, 512) * 1024,
  }),
  photoRetentionDays: integer('PHOTO_RETENTION_DAYS', 90, 1, 3650),
  earlyMinutes: integer('APPOINTMENT_EARLY_MINUTES', 30, 0, 1440),
  lateMinutes: integer('APPOINTMENT_LATE_MINUTES', 30, 0, 1440),
})
