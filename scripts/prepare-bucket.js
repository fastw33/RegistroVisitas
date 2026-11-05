const { CreateBucketCommand, GetBucketPolicyCommand } = require('@aws-sdk/client-s3')
const { getStorage } = require('../src/integrations/s3')
const env = require('../src/config/env')
const ApiError = require('../src/utils/ApiError')

async function main() {
  const storage = getStorage()
  let created = false
  try { await storage.check() }
  catch (error) {
    if (error.code !== 'STORAGE_BUCKET_UNAVAILABLE') throw error
    try {
      await storage.send(new CreateBucketCommand({
        Bucket: env.s3.bucket,
        ...(env.s3.region !== 'us-east-1' ? { CreateBucketConfiguration: { LocationConstraint: env.s3.region } } : {}),
      }))
      created = true
    } catch (creationError) {
      // Si otro proceso lo creó al mismo tiempo, reutilizarlo solo si es accesible.
      try { await storage.check() } catch { throw creationError }
    }
  }
  try {
    const result = await storage.client.send(new GetBucketPolicyCommand({ Bucket: env.s3.bucket }))
    const policy = JSON.parse(result.Policy || '{}')
    const statements = Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement].filter(Boolean)
    if (statements.some(s => s.Effect === 'Allow' && (s.Principal === '*' || s.Principal?.AWS === '*' || s.Principal?.AWS?.includes?.('*')))) {
      throw new ApiError(409, 'El bucket tiene una política de acceso anónimo; revísela antes de guardar fotos', 'BUCKET_POLICY_NOT_PRIVATE')
    }
  } catch (error) {
    if (!['NoSuchBucketPolicy', 'NoSuchPolicy'].includes(error.name)) throw error
  }
  console.log(`Bucket ${env.s3.bucket}: ${created ? 'creado' : 'existente'}, sin política de acceso anónimo. No se modificaron otros buckets.`)
}
main().catch(error => {
  console.error(error instanceof ApiError ? `${error.code}: ${error.message}` : `No se pudo preparar el bucket (${error.name || 'error'})`)
  process.exitCode = 1
})
