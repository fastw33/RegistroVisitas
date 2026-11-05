const router = require('express').Router()
const roles = require('../../middlewares/roles.middleware')
const controller = require('./sede.controller')
const validator = require('./sede.validator')
router.get('/', validator.list, controller.getAll)
router.post('/', roles('admin'), validator.create, controller.create)
router.patch('/:id', roles('admin'), validator.update, controller.update)
module.exports = router
