const env = require('../../config/env')
const { S3Storage } = require('./s3.storage')
let storage
function getStorage() {
  if (!storage) storage = new S3Storage(env.s3)
  return storage
}
module.exports = { getStorage }
