const { Schema } = require('mongoose')
const actor = { type: Schema.Types.ObjectId, ref: 'Usuario' }
const options = { timestamps: true, strict: 'throw', versionKey: false }
const eventSchema = new Schema({
  accion: { type: String, required: true }, actor: { ...actor, required: true },
  fecha: { type: Date, default: Date.now }, detalle: { type: String, maxlength: 500 },
}, { _id: false, strict: 'throw' })
const event = (user, accion, detalle) => ({ actor: user._id, accion, fecha: new Date(), detalle })
module.exports = { actor, options, eventSchema, event }
