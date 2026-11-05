const read = require('../../utils/transaction').read
const service = require('./archivo.service')
const { pipeline } = require('node:stream/promises')
exports.upload = async (req, res) => {
  try { res.status(201).json(await service.upload(req.datos, req.file, req.usuario)) }
  finally { req.releasePhotoSlot?.() }
}
exports.getAll = async (req, res) => res.json(await read(() => service.getAll(req.query)))
exports.download = async (req, res) => {
  let opened
  try {
    const { row, body } = await read(async () => { opened = await service.download(req.params.id, req.usuario, req.id); return opened })
    const extension = row.mime === 'image/webp' ? 'webp' : 'jpg'
    res.set({ 'Content-Type': row.mime, 'Content-Disposition': `inline; filename="${row._id}.${extension}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
    await pipeline(body, res)
  } catch (error) { opened?.body.destroy(); throw error }
}
exports.remove = async (req, res) => res.json(await service.remove(req.params.id, req.usuario))
