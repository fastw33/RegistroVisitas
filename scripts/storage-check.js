const { getStorage } = require('../src/integrations/s3')
async function main() {
  await getStorage().check()
  console.log('El bucket S3 configurado responde. No se escribieron objetos.')
}
main().catch(error => { console.error(`${error.code || 'STORAGE_ERROR'}: ${error.message}`); process.exitCode = 1 })
