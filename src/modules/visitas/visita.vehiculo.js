const { Schema } = require('mongoose')
const { body } = require('../../utils/validators')

const schema = new Schema({
  presente: { type: Boolean, default: true },
  placa: { type: String, maxlength: 12 },
  descripcion: { type: String, maxlength: 150 },
}, { _id: false })

const validators = (allowRemoval = false) => [
  body('vehiculo').optional()
    .custom(value => (allowRemoval && value === null) || (value !== null && typeof value === 'object' && !Array.isArray(value))).bail()
    .custom(value => value === null || Object.keys(value).every(key => ['placa', 'descripcion'].includes(key)))
    .withMessage('El vehículo solo admite placa y descripción'),
  body('vehiculo.placa').optional().isString().bail().trim().toUpperCase()
    .customSanitizer(value => value.replace(/[\s-]/g, ''))
    .matches(/^(?:[A-Z0-9]{3,12})?$/).withMessage('La placa debe contener entre 3 y 12 letras o números'),
  body('vehiculo.descripcion').optional().isString().bail().trim().isLength({ max: 150 }),
]

// Sin vehículo se conserva el hash de las peticiones anteriores a esta función.
const fingerprint = data => data.vehiculo ? {
  vehiculo: { placa: data.vehiculo.placa || null, descripcion: data.vehiculo.descripcion || null },
} : {}

module.exports = { schema, validators, fingerprint }
