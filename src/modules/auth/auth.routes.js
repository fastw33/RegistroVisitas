const router = require('express').Router()
const { rateLimit } = require('express-rate-limit')
const auth = require('../../middlewares/auth.middleware')
const controller = require('./auth.controller')
const validator = require('./auth.validator')
router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Demasiados intentos; intente más tarde' } } }), validator.login, controller.login)
router.get('/me', auth, controller.me)
module.exports = router
