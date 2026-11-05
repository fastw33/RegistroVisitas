const { body, id, text, page, finish } = require('../../utils/validators')
const timezone = optional => {
  let chain = body('zonaHoraria'); if (optional) chain = chain.optional()
  return chain.isString().bail().custom(v => { new Intl.DateTimeFormat('es-CO', { timeZone: v }); return true })
}
exports.create = finish([text('codigo', 30), text('nombre', 150), text('direccion', 300, true), timezone(true)])
exports.update = finish([id(), text('nombre', 150, true), text('direccion', 300, true), timezone(true), body('activa').optional().isBoolean({ strict: true })])
exports.list = finish(page)
