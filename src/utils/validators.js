const { body, param, query, checkExact } = require('express-validator')
const validate = require('./validatorResult')
const id = (name = 'id') => param(name).isMongoId().withMessage('Identificador inválido')
const ref = (name, optional = false) => optional ? body(name).optional().isMongoId() : body(name).isMongoId()
const text = (name, max = 200, optional = false) => {
  let chain = body(name)
  if (optional) chain = chain.optional()
  return chain.isString().bail().trim().isLength({ min: 1, max })
}
const date = (name, optional = false) => {
  let chain = body(name)
  if (optional) chain = chain.optional()
  // Exigir zona horaria: los datos se guardan en UTC, sin depender de la zona del servidor.
  return chain.isString().bail().matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/).bail().isISO8601({ strict: true }).toDate()
}
const page = [query('page').optional().isInt({ min: 1, max: 100000 }), query('limit').optional().isInt({ min: 1, max: 100 })]
const finish = chains => [...chains, checkExact([], { locations: ['body'], message: 'Campos no permitidos' }), validate]
module.exports = { body, param, query, id, ref, text, date, page, finish, validate }
