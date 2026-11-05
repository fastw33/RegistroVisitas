const { connectDB, disconnectDB } = require('../src/config/db')
const Usuario = require('../src/modules/usuarios/usuario.model')
const bcrypt = require('bcryptjs')

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD || ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('Configure ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres, máximo 72 bytes)')
  await connectDB()
  // Solo crea, nunca reinicia contraseñas o modifica usuarios existentes.
  if (await Usuario.exists({ email })) throw new Error('El usuario ya existe; no se modificó')
  const passwordHash = await bcrypt.hash(password, 12)
  await require('../src/utils/transaction')(async session => {
    const [user] = await Usuario.create([{ email, nombre: process.env.ADMIN_NAME || 'Administrador', rol: 'admin', passwordHash }], { session })
    await require('../src/modules/auditoria/auditoria.service').record(user, 'bootstrap', 'usuarios', user._id, session)
  })
  console.log('Administrador creado. Quite ADMIN_PASSWORD de .env después de usarlo.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(disconnectDB)
