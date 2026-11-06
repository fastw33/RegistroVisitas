// OpenAPI se sirve en /openapi.json y se puede importar en Postman, Insomnia o Swagger.
const ref = name => ({ $ref: `#/components/schemas/${name}` })
const str = (description, extra = {}) => ({ type: 'string', ...(description ? { description } : {}), ...extra })
const oid = str('ObjectId de MongoDB', { pattern: '^[a-fA-F0-9]{24}$' })
const date = str('ISO 8601 con zona horaria; ejemplo 2026-11-04T09:00:00-05:00', { format: 'date-time' })
const object = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false })
const schemas = {
  DatosDocumento: object({ datosDocumento: object({
    fechaNacimiento: str('Fecha civil, sin hora', { format: 'date' }), sexo: str('', { enum: ['F', 'M', 'X'] }),
    grupoSanguineo: str('Dato sensible opcional', { enum: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] }),
    lugarNacimiento: str('', { maxLength: 150 }), codigoLugarNacimiento: str('Código original del PDF417; no se traduce a un catálogo', { pattern: '^\\d{5}$' }),
    estaturaCm: { type: 'integer', minimum: 40, maximum: 260 }, fechaExpedicion: str('', { format: 'date' }), lugarExpedicion: str('', { maxLength: 150 }),
  }), aceptado: { type: 'boolean', enum: [true] }, version: str('', { example: '1.0' }) }, ['datosDocumento', 'aceptado', 'version']),
  Login: object({ email: str('', { format: 'email' }), password: str('', { format: 'password' }) }, ['email', 'password']),
  Usuario: object({ nombre: str(), email: str('', { format: 'email' }), rol: str('', { enum: ['admin', 'recepcion', 'anfitrion'] }), password: str('12 caracteres mínimo; máximo 72 bytes UTF-8', { format: 'password' }), wmsId: str() }, ['nombre', 'email', 'rol']),
  UsuarioUpdate: object({ nombre: str(), rol: str('', { enum: ['admin', 'recepcion', 'anfitrion'] }), activo: { type: 'boolean' }, password: str('', { format: 'password' }), wmsId: str() }),
  Sede: object({ codigo: str(), nombre: str(), direccion: str(), zonaHoraria: str('Zona IANA', { default: 'America/Bogota' }) }, ['codigo', 'nombre']),
  SedeUpdate: object({ nombre: str(), direccion: str(), zonaHoraria: str(), activa: { type: 'boolean' } }),
  Visitante: object({ tipoDocumento: str('', { enum: ['CC', 'CE', 'TI', 'PASAPORTE', 'PPT', 'OTRO'] }), numeroDocumento: str(), nombres: str(), apellidos: str(), empresa: str(), telefono: str(), email: str('', { format: 'email' }), wmsIdExterno: str(), atributos: { type: 'object', additionalProperties: { type: 'string', maxLength: 500 }, maxProperties: 30 } }, ['tipoDocumento', 'numeroDocumento', 'nombres', 'apellidos']),
  Consentimiento: object({ visitante: oid, finalidad: str('', { enum: ['registro_visitas', 'foto_rostro', 'foto_documento', 'datos_documento', 'foto_vehiculo', 'foto_placa'] }), version: str('', { example: '1.0' }), aceptado: { type: 'boolean', enum: [true] }, medio: str('', { enum: ['casilla', 'firma', 'verbal'] }), evidencia: str('Referencia o descripción comprobable de la manifestación del visitante') }, ['visitante', 'finalidad', 'version', 'aceptado', 'medio', 'evidencia']),
  Cita: object({ visitante: oid, sede: oid, anfitrion: oid, motivo: str(), area: str(), inicio: date, fin: date, repeticion: object({ cantidad: { type: 'integer', minimum: 2, maximum: 30 }, cadaSemanas: { type: 'integer', minimum: 1, maximum: 4 } }, ['cantidad', 'cadaSemanas']) }, ['visitante', 'sede', 'anfitrion', 'motivo', 'inicio', 'fin']),
  Reprogramar: object({ inicio: date, fin: date }, ['inicio', 'fin']),
  Motivo: object({ motivo: str() }),
  Revocacion: object({ motivo: str() }, ['motivo']),
  Pase: object({ token: str('Valor opaco de 64 caracteres hexadecimales', { pattern: '^[a-f0-9]{64}$' }) }, ['token']),
  Vehiculo: object({ presente: { type: 'boolean', readOnly: true, description: 'El servidor lo asigna al registrar un vehículo, incluso sin placa ni descripción.' }, placa: str('Opcional; se normaliza a mayúsculas sin espacios ni guiones', { maxLength: 12, example: 'ABC123' }), descripcion: str('Opcional: tipo, marca o color del vehículo', { maxLength: 150 }) }),
  Identidad: object({ vehiculo: { type: 'object', allOf: [ref('Vehiculo')], nullable: true, description: 'Opcional. null retira el vehículo de una solicitud antes de confirmar su entrada.' }, identidadVerificada: { type: 'boolean', enum: [true] } }, ['identidadVerificada']),
  Equipo: object({ descripcion: str(), serial: str() }, ['descripcion']),
  Visita: object({ visitante: oid, sede: oid, anfitrion: oid, motivo: str(), area: str(), equipos: { type: 'array', maxItems: 20, items: ref('Equipo') }, observaciones: str(), vehiculo: ref('Vehiculo') }, ['visitante', 'sede', 'anfitrion', 'motivo']),
  EntradaCita: { ...object({ cita: oid, token: str(), identidadVerificada: { type: 'boolean', enum: [true] }, equipos: { type: 'array', maxItems: 20, items: ref('Equipo') }, observaciones: str(), vehiculo: ref('Vehiculo') }, ['identidadVerificada']), oneOf: [{ required: ['cita'] }, { required: ['token'] }] },
  EntradaDirecta: object({ visitante: oid, sede: oid, anfitrion: oid, motivo: str(), area: str(), identidadVerificada: { type: 'boolean', enum: [true] }, equipos: { type: 'array', maxItems: 20, items: ref('Equipo') }, observaciones: str(), vehiculo: ref('Vehiculo') }, ['visitante', 'motivo', 'identidadVerificada']),
  Archivo: object({ visitante: oid, visita: oid, tipo: str('', { enum: ['foto_rostro', 'foto_documento', 'foto_vehiculo', 'foto_placa'] }), archivo: str('JPEG, PNG o WebP; máximo configurado por MAX_UPLOAD_MB', { format: 'binary' }) }, ['visitante', 'tipo', 'archivo']),
  Error: { type: 'object', properties: { error: { type: 'object', properties: { code: str(), message: str(), details: { type: 'array', items: { type: 'object' } } } }, requestId: str() } },
  Pagina: { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, pages: { type: 'integer' } } } } },
}
schemas.VisitanteUpdate = object({ ...schemas.Visitante.properties, activo: { type: 'boolean' } })
schemas.Archivo.oneOf = [
  { properties: { tipo: { enum: ['foto_rostro', 'foto_documento'] } } },
  { properties: { tipo: { enum: ['foto_vehiculo', 'foto_placa'] } }, required: ['visita'] },
]
for (const name of ['Cita', 'Visita']) {
  schemas[name].required = schemas[name].required.filter(field => field !== 'sede')
  schemas[name].properties.sede = { ...oid, description: 'Opcional: la API asigna automáticamente la oficina actual.' }
}
delete schemas.VisitanteUpdate.properties.tipoDocumento
delete schemas.VisitanteUpdate.properties.numeroDocumento
delete schemas.VisitanteUpdate.properties.nombres
delete schemas.VisitanteUpdate.properties.apellidos
schemas.IdentidadCorreccion = object(Object.fromEntries(['tipoDocumento', 'numeroDocumento', 'nombres', 'apellidos'].map(key => [key, schemas.Visitante.properties[key]])), ['tipoDocumento', 'numeroDocumento', 'nombres', 'apellidos'])
schemas.CorreccionVisitante = object({ anterior: ref('IdentidadCorreccion'), correccion: ref('IdentidadCorreccion'), motivo: str('Motivo verificado de la corrección', { minLength: 1, maxLength: 500 }), requestKey: str('UUID v4 del intento; conservar al reintentar', { format: 'uuid' }) }, ['anterior', 'correccion', 'motivo', 'requestKey'])
const paths = {}
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
]
const filter = (name, schema = str()) => ({ name, in: 'query', schema })
function route(method, path, summary, { body, roles, paged, filters = [], publicRoute, status = 200, multipart, idempotent, binary } = {}) {
  const parameters = [...(path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: oid }] : []), ...(paged ? pageParams : []), ...filters]
  if (idempotent) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: str('', { format: 'uuid' }) })
  const operation = { summary, tags: [path.split('/')[2] || 'sistema'], security: publicRoute ? [] : [{ bearerAuth: [] }],
    ...(roles ? { description: `Roles: ${roles}. Los anfitriones solo pueden operar sus propias citas y visitas.` } : {}),
    ...(parameters.length ? { parameters } : {}), responses: {
      [status]: { description: 'Operación exitosa', content: binary ? { 'image/webp': { schema: str('', { format: 'binary' }) }, 'image/jpeg': { schema: str('', { format: 'binary' }) } } : { 'application/json': { schema: paged ? ref('Pagina') : { type: 'object' } } } },
      400: { description: 'Validación inválida', content: { 'application/json': { schema: ref('Error') } } },
      401: { description: 'Sin autenticación válida' }, 403: { description: 'Sin permisos' }, 404: { description: 'No encontrado' }, 409: { description: 'Conflicto de estado o duplicado' }, 422: { description: 'Faltan autorizaciones o reglas de negocio' },
    } }
  if (body) operation.requestBody = { required: true, content: { [multipart ? 'multipart/form-data' : 'application/json']: { schema: ref(body) } } }
  paths[path] ||= {}; paths[path][method] = operation
}
route('get', '/health', 'Proceso disponible', { publicRoute: true })
route('get', '/ready', 'Conexión a MongoDB disponible', { publicRoute: true })
route('post', '/api/auth/login', 'Iniciar sesión local', { body: 'Login', publicRoute: true })
route('get', '/api/auth/me', 'Usuario autenticado')
route('get', '/api/usuarios/anfitriones', 'Directorio mínimo de receptores locales y personal vigente de WMS; puede incluir warning si WMS no está disponible')
route('get', '/api/usuarios', 'Listar usuarios', { roles: 'admin', paged: true })
route('post', '/api/usuarios', 'Crear usuario o asociar usuario WMS', { body: 'Usuario', roles: 'admin', status: 201 })
route('patch', '/api/usuarios/{id}', 'Actualizar usuario', { body: 'UsuarioUpdate', roles: 'admin' })
route('get', '/api/sedes', 'Listar sedes', { paged: true })
route('post', '/api/sedes', 'Crear sede', { body: 'Sede', roles: 'admin', status: 201 })
route('patch', '/api/sedes/{id}', 'Actualizar sede', { body: 'SedeUpdate', roles: 'admin' })
route('get', '/api/visitantes', 'Buscar visitantes', { roles: 'admin, recepcion', paged: true, filters: [filter('documento'), filter('q')] })
route('get', '/api/visitantes/identidad', 'Buscar identidad básica por tipo y número exactos; devuelve data o null', { filters: [{ ...filter('tipoDocumento', str('', { enum: ['CC', 'CE', 'TI', 'PASAPORTE', 'PPT', 'OTRO'] })), required: true }, { ...filter('numeroDocumento', str()), required: true }] })
route('post', '/api/visitantes', 'Crear ficha de visitante', { body: 'Visitante', status: 201 })
route('get', '/api/visitantes/{id}', 'Consultar ficha', { roles: 'admin, recepcion' })
route('patch', '/api/visitantes/{id}', 'Actualizar ficha', { roles: 'admin, recepcion', body: 'VisitanteUpdate' })
route('post', '/api/visitantes/{id}/correcciones', 'Corregir identidad con motivo e historial, control de concurrencia y reintentos idempotentes. Actualiza visitas abiertas, conserva las cerradas y revoca pases QR.', { roles: 'admin', body: 'CorreccionVisitante' })
route('get', '/api/visitantes/{id}/correcciones', 'Historial de correcciones de identidad, valores anteriores y nuevos, motivo y autor', { roles: 'admin', paged: true })
route('patch', '/api/visitantes/{id}/datos-documento', 'Guardar datos opcionales y autorización expresa en una operación protegida; no altera identidad. Reemplaza el conjunto de datos opcionales.', { roles: 'admin, recepcion', body: 'DatosDocumento' })
route('get', '/api/visitantes/{id}/historial', 'Historial de visitas de una persona', { roles: 'admin, recepcion', paged: true })
route('get', '/api/consentimientos/politica', 'Texto vigente de autorizaciones y responsable')
route('get', '/api/consentimientos', 'Consultar autorizaciones', { roles: 'admin, recepcion', paged: true, filters: [{ ...filter('visitante', oid), required: true }] })
route('post', '/api/consentimientos', 'Registrar manifestación expresa del visitante', { roles: 'admin, recepcion', body: 'Consentimiento', status: 201 })
route('post', '/api/consentimientos/{id}/revocar', 'Revocar una autorización; bloquea acceso a sus fotos', { roles: 'admin, recepcion', body: 'Revocacion' })
const agendaFilters = [filter('sede', oid), filter('visitante', oid), filter('anfitrion', oid), filter('estado'), filter('desde', date), filter('hasta', date)]
route('get', '/api/citas', 'Agenda filtrable; anfitrión ve solo sus citas', { paged: true, filters: agendaFilters })
route('post', '/api/citas', 'Agendar una cita o serie semanal con aprobación automática y pase QR por fecha. Devuelve data y pases listos para compartir en la misma operación.', { body: 'Cita', status: 201 })
route('get', '/api/citas/{id}', 'Consultar cita')
for (const action of ['aprobar', 'cancelar']) route('post', `/api/citas/{id}/${action}`, `${action} cita`, { roles: 'admin, anfitrion', body: 'Motivo' })
route('post', '/api/citas/{id}/no-asistio', 'Marcar ausencia después de terminar la ventana de ingreso', { body: 'Motivo' })
route('patch', '/api/citas/{id}/reprogramar', 'Reprogramar; exige nueva aprobación e invalida el pase', { body: 'Reprogramar' })
route('post', '/api/citas/{id}/pase', 'Emitir pase QR; reemplaza cualquier pase anterior')
route('post', '/api/citas/validar-pase', 'Validar pase sin registrar entrada. Llegadas anticipadas o tardías devuelven avisoHorario sin bloquear una cita aprobada.', { roles: 'admin, recepcion', body: 'Pase' })
route('get', '/api/visitas', 'Consultar visitas e historial', { paged: true, filters: agendaFilters })
route('get', '/api/visitas/resumen', 'Cantidades por estado; anfitrión solo ve las propias')
route('post', '/api/visitas', 'Solicitar visita sin cita', { roles: 'admin, recepcion', body: 'Visita', status: 201 })
route('post', '/api/visitas/entrada', 'Registrar entrada con cita o pase QR; reintentos idempotentes', { roles: 'admin, recepcion', body: 'EntradaCita', idempotent: true })
route('post', '/api/visitas/ingreso-directo', 'Registrar entrada sin cita directamente por recepción, sin solicitud ni aprobación del anfitrión; requiere consentimiento y verificación documental', { roles: 'admin, recepcion', body: 'EntradaDirecta', idempotent: true })
route('get', '/api/visitas/{id}', 'Consultar visita')
for (const action of ['autorizar', 'rechazar']) route('post', `/api/visitas/{id}/${action}`, `${action} solicitud sin cita`, { roles: 'admin, anfitrion', body: 'Motivo' })
route('post', '/api/visitas/{id}/entrada', 'Confirmar identidad y entrada de visita autorizada', { roles: 'admin, recepcion', body: 'Identidad' })
route('post', '/api/visitas/{id}/salida', 'Registrar salida; reintentar no duplica eventos', { roles: 'admin, recepcion' })
route('get', '/api/archivos', 'Listar fotos vigentes autorizadas', { roles: 'admin, recepcion', paged: true, filters: [{ ...filter('visitante', oid), required: true }, filter('visita', oid)] })
route('post', '/api/archivos', 'Subir foto privada con autorización específica', { roles: 'admin, recepcion', body: 'Archivo', multipart: true, status: 201 })
route('get', '/api/archivos/{id}/contenido', 'Consultar foto; registra auditoría', { roles: 'admin, recepcion', binary: true })
route('delete', '/api/archivos/{id}', 'Eliminar foto privada', { roles: 'admin, recepcion' })
route('get', '/api/auditoria', 'Consultar trazabilidad sin imágenes ni cuerpos de solicitudes', { roles: 'admin', paged: true, filters: [filter('entidad'), filter('entidadId')] })
module.exports = {
  openapi: '3.0.3', info: { title: 'RegistroVisitas API', version: '1.0.0', description: 'Express + MongoDB. Fecha/hora UTC; recepción usa cámara desde el frontend. No incluye OCR, decodificación PDF417 ni reconocimiento facial.' },
  servers: [{ url: 'https://visitas.appfastway.com', description: 'API de visitas; disponibilidad sujeta al despliegue del servidor' }, { url: 'http://localhost:3015', description: 'Desarrollo local; en celular usar HTTPS' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }, schemas }, paths,
}
