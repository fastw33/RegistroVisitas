const { body, finish } = require('../../utils/validators')
exports.login = finish([
  body('email').isEmail().bail().trim().toLowerCase().isLength({ max: 254 }),
  body('password').isString().bail().isLength({ min: 1, max: 200 }),
])
