const { Schema, model } = require('mongoose')
const { options, actor } = require('../../utils/model')
const datosDocumento = new Schema({
  fechaNacimiento: String, sexo: { type: String, enum: ['F', 'M', 'X'] },
  grupoSanguineo: { type: String, enum: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] },
  lugarNacimiento: { type: String, maxlength: 150 }, codigoLugarNacimiento: { type: String, match: /^\d{5}$/ },
  estaturaCm: { type: Number, min: 40, max: 260 }, fechaExpedicion: String,
  lugarExpedicion: { type: String, maxlength: 150 },
}, { _id: false, strict: 'throw' })
const schema = new Schema({
  tipoDocumento: { type: String, enum: ['CC', 'CE', 'TI', 'PASAPORTE', 'PPT', 'OTRO'], required: true },
  numeroDocumento: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
  nombres: { type: String, required: true, trim: true, maxlength: 100 },
  apellidos: { type: String, required: true, trim: true, maxlength: 100 },
  empresa: { type: String, trim: true, maxlength: 150 },
  telefono: { type: String, maxlength: 30 }, email: { type: String, lowercase: true, maxlength: 254 },
  wmsIdExterno: { type: String, maxlength: 100 },
  activo: { type: Boolean, default: true },
  creadoPor: { ...actor, required: true },
  datosDocumento: { type: datosDocumento, default: undefined },
  consentimientoDocumento: { type: Schema.Types.ObjectId, ref: 'Consentimiento', select: false },
  // Campo tipado para datos adicionales, sin permitir operadores o contenido arbitrario.
  atributos: { type: Map, of: { type: String, maxlength: 500 }, default: {} },
}, options)
schema.index({ tipoDocumento: 1, numeroDocumento: 1 }, { unique: true })
module.exports = model('Visitante', schema)
