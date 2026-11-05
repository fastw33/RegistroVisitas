const { validationResult, matchedData } = require('express-validator')
module.exports = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: errors.array().map(e => ({ field: e.path, message: e.msg })) }, requestId: req.id })
  req.datos = matchedData(req, { locations: ['body'], includeOptionals: false })
  next()
}
