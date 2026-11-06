const { createHash } = require('node:crypto')
const env = require('../config/env')
const ApiError = require('../utils/ApiError')

const receiverId = id => createHash('sha256').update(`registro-visitas:wms:${id}`).digest('hex').slice(0, 24)
function normalize(rows, now = new Date()) {
  if (!Array.isArray(rows)) throw new ApiError(502, 'WMS no devolvió un directorio de personal válido', 'WMS_DIRECTORY_UNAVAILABLE')
  const people = new Map(), today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(now)
  for (const row of rows) {
    const id = String(row.id_usuario ?? '')
    const nombre = [row.Nombre, row.Apellido].filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean).join(' ').slice(0, 150)
    if (![true, 1].includes(row.activo) || !/^\d{1,20}$/.test(id) || !nombre || (row.fecha_retiro && String(row.fecha_retiro).slice(0, 10) <= today)) continue
    people.set(id, { _id: receiverId(id), wmsId: id, nombre })
  }
  return [...people.values()]
}
async function getPersonal(token) {
  const url = `${env.wmsApiUrl.replace(/\/+$/, '')}/personal/receptores-visitas`
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000), redirect: 'error' })
    if (!response.ok) throw new Error('Directorio no disponible')
    return normalize(await response.json())
  } catch {
    throw new ApiError(503, 'No pudimos validar los usuarios activos de WMS. Reintenta para cargar el personal disponible.', 'WMS_DIRECTORY_UNAVAILABLE')
  }
}
module.exports = { getPersonal, normalize, receiverId }
