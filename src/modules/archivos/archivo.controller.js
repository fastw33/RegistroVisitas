const service = require('./archivo.service')
const { pipeline } = require('node:stream/promises')
exports.upload = async (req, res) => {
  try { res.status(201).json(await service.upload(req.datos, req.file, req.usuario)) }
  finally { req.releasePhotoSlot?.() }
}
exports.getAll = async (req, res) => res.json(await service.getAll(req.query))
exports.download = async (req, res) => {
  const { row, body } = await service.download(req.params.id, req.usuario, req.id)
  const extension = row.mime === 'image/webp' ? 'webp' : 'jpg'
  res.set({ 'Content-Type': row.mime, 'Content-Disposition': `inline; filename="${row._id}.${extension}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
  await pipeline(body, res)
}
exports.remove = async (req, res) => res.json(await service.remove(req.params.id, req.usuario))
