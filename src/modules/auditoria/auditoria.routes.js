const router = require('express').Router()
const roles = require('../../middlewares/roles.middleware')
const controller = require('./auditoria.controller')
const validator = require('./auditoria.validator')
router.get('/', roles('admin'), validator.list, controller.getAll)
module.exports = router
