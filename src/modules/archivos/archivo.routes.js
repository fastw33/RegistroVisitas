const router = require('express').Router()
const multer = require('multer')
const env = require('../../config/env')
const roles = require('../../middlewares/roles.middleware')
const controller = require('./archivo.controller')
const validator = require('./archivo.validator')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.maxUploadBytes, files: 1, fields: 3, parts: 4, fieldSize: 1000 } })
router.use(roles('admin', 'recepcion'))
router.get('/', validator.list, controller.getAll)
router.post('/', require('../../middlewares/photoCapacity.middleware'), (req, res, next) => {
  upload.single('archivo')(req, res, error => {
    if (error || req.aborted) req.releasePhotoSlot()
    if (req.aborted && !error) return
    next(error)
  })
}, validator.upload, controller.upload)
router.get('/:id/contenido', validator.get, controller.download)
router.delete('/:id', validator.get, controller.remove)
module.exports = router
