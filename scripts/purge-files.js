const { connectDB, disconnectDB } = require('../src/config/db')
async function main() {
  await connectDB()
  const result = await require('../src/modules/archivos/archivo.service').purge()
  console.log(JSON.stringify(result))
  if (result.pendientes > 0) process.exitCode = 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(disconnectDB)
