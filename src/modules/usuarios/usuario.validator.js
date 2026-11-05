const { body, id, text, page, finish } = require('../../utils/validators')
const password = () => body('password').optional().isString().bail().isLength({ min: 12 }).custom(v => Buffer.byteLength(v, 'utf8') <= 72).withMessage('Contraseña de 12 caracteres mínimo y 72 bytes máximo')
exports.create = finish([
  text('nombre', 150), body('email').isEmail().bail().trim().toLowerCase().isLength({ max: 254 })
    .custom((value, { req }) => Boolean(req.body.password || req.body.wmsId)).withMessage('Se requiere password o wmsId'),
  body('rol').isIn(['admin', 'recepcion', 'anfitrion']), password(), text('wmsId', 100, true),
])
exports.update = finish([
  id(), text('nombre', 150, true), body('rol').optional().isIn(['admin', 'recepcion', 'anfitrion']),
  body('activo').optional().isBoolean({ strict: true }), text('wmsId', 100, true), password(),
])
exports.list = finish(page)
