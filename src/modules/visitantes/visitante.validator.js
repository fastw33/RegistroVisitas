const { body, query, id, text, page, finish } = require('../../utils/validators')
const fields = optional => [
  optional ? body('tipoDocumento').optional().isIn(['CC', 'CE', 'TI', 'PASAPORTE', 'PPT', 'OTRO']) : body('tipoDocumento').isIn(['CC', 'CE', 'TI', 'PASAPORTE', 'PPT', 'OTRO']),
  text('numeroDocumento', 30, optional).bail().matches(/^[a-zA-Z0-9-]+$/).toUpperCase(),
  text('nombres', 100, optional), text('apellidos', 100, optional),
  text('empresa', 150, true), text('telefono', 30, true),
  body('email').optional().isEmail().bail().toLowerCase().isLength({ max: 254 }),
  text('wmsIdExterno', 100, true),
  body('atributos').optional().custom(v => v && !Array.isArray(v) && typeof v === 'object' && Object.keys(v).length <= 30 && Object.entries(v).every(([k, value]) => /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(k) && !['constructor', 'prototype', '__proto__'].includes(k) && typeof value === 'string' && value.length <= 500)),
]
exports.create = finish(fields(false))
// Todas las correcciones de identidad pasan por la operación administrativa auditada.
exports.update = finish([id(), ...fields(true).slice(4), body('activo').optional().isBoolean({ strict: true })])
const correctionIdentity = prefix => [
  body(`${prefix}.tipoDocumento`).isIn(['CC', 'CE', 'TI', 'PASAPORTE', 'PPT', 'OTRO']),
  text(`${prefix}.numeroDocumento`, 30).bail().matches(/^[a-zA-Z0-9-]+$/).toUpperCase(),
  text(`${prefix}.nombres`, 100), text(`${prefix}.apellidos`, 100),
]
exports.correct = finish([id(), ...correctionIdentity('anterior'), ...correctionIdentity('correccion'), text('motivo', 500), body('requestKey').isUUID(4)])
exports.corrections = finish([id(), ...page])
exports.get = finish([id()])
exports.identity = finish([query('tipoDocumento').isIn(['CC', 'CE', 'TI', 'PASAPORTE', 'PPT', 'OTRO']), query('numeroDocumento').isString().isLength({ min: 1, max: 30 }).matches(/^[a-zA-Z0-9-]+$/)])
exports.list = finish([...page, query('documento').optional().isString().isLength({ min: 1, max: 30 }), query('q').optional().isString().isLength({ min: 2, max: 100 })])
const documentKeys = ['fechaNacimiento', 'sexo', 'grupoSanguineo', 'lugarNacimiento', 'codigoLugarNacimiento', 'estaturaCm', 'fechaExpedicion', 'lugarExpedicion']
const calendarDate = key => body(`datosDocumento.${key}`).optional().isString().bail().matches(/^\d{4}-\d{2}-\d{2}$/).bail().isISO8601({ strict: true }).bail().custom(value => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return value >= '1900-01-01' && value <= today
})
exports.document = finish([
  id(), body('aceptado').isBoolean({ strict: true }).custom(value => value === true).withMessage('Se requiere autorización expresa para los datos opcionales'),
  text('version', 30),
  body('datosDocumento').isObject({ strict: true }).bail().custom(value => Object.keys(value).length > 0 && Object.keys(value).every(key => documentKeys.includes(key))),
  calendarDate('fechaNacimiento'), calendarDate('fechaExpedicion'),
  body('datosDocumento.sexo').optional().isIn(['F', 'M', 'X']),
  body('datosDocumento.grupoSanguineo').optional().isIn(['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-']),
  text('datosDocumento.lugarNacimiento', 150, true), text('datosDocumento.lugarExpedicion', 150, true),
  body('datosDocumento.codigoLugarNacimiento').optional().isString().bail().matches(/^\d{5}$/),
  body('datosDocumento.estaturaCm').optional().custom(value => Number.isInteger(value) && value >= 40 && value <= 260),
  body('datosDocumento').custom(value => !value.fechaNacimiento || !value.fechaExpedicion || value.fechaExpedicion >= value.fechaNacimiento).withMessage('La expedición no puede ser anterior al nacimiento'),
])
