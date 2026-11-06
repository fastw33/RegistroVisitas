# RegistroVisitas API

API independiente de agenda y control de visitantes. Conserva la arquitectura de `wmsBack`: Node.js, Express, CommonJS, `src/config`, `src/middlewares`, `src/model`, `src/modules` y `src/utils`. La persistencia utiliza MongoDB + Mongoose en lugar de Sequelize/MySQL.

La instalación opera en una sola oficina. La API prepara la referencia automáticamente al iniciar; citas y solicitudes pueden omitir `sede`. FrontWms no muestra creación, selección ni filtros de oficinas. Los endpoints de sedes se conservan para compatibilidad con integraciones existentes.

## Capas y carpetas

```text
RegistroVisitas/
  src/
    app.js                     # Configuración HTTP y montaje de rutas
    server.js                  # Inicio, conexión a BD y cierre
    config/                    # Variables de entorno y MongoDB
    integrations/s3/           # SDK S3/MinIO, mismo patrón de GestorDocumental
    middlewares/               # Autenticación, roles y errores
    model/index.js             # Registro central de modelos e índices
    modules/
      auth/                    # Sesión local y perfil
      usuarios/                # Administrador, recepción, anfitrión y asociación WMS
      sedes/                   # Oficinas y zona horaria
      visitantes/              # Ficha única y vínculo opcional con WMS
      consentimientos/         # Autorizaciones por finalidad y revocación
      citas/                   # Agenda, recurrencias, aprobación y pases QR
      visitas/                 # Entradas, salidas, historial y presentes
      archivos/                # Fotos privadas, validación y conservación
      auditoria/               # Trazabilidad de acciones
    utils/                     # Validación, paginación, transacciones y errores
  docs/
    openapi.js                 # Contrato OpenAPI 3.0.3
    requests.http              # Ejemplos de peticiones
  scripts/                     # Preparación, administrador, limpieza y revisión
  test/api.test.js             # Integración con MongoDB replica set aislado
  .local/mongo/                # MongoDB de desarrollo; no contiene fotos
```

Cada módulo de negocio tiene `*.routes.js`, `*.validator.js`, `*.controller.js`, `*.service.js` y `*.model.js`. `auth` reutiliza el modelo de usuarios. Las rutas definen permisos, los validadores filtran entradas, los controladores manejan HTTP, los servicios ejecutan reglas de negocio y los modelos definen persistencia e índices.

## Preparación y arranque local

Requiere Node.js 20.19 o superior (Node 22 recomendado), MongoDB (standalone o replica set) y almacenamiento S3/MinIO para fotos. Detecta automáticamente el modo existente; no requiere reconfigurar MongoDB. También funciona con MongoDB Atlas. Nunca guarda fotografías en disco local.

Desde PowerShell, en esta carpeta:

```powershell
npm ci
npm run setup
npm run config:gestor
```

`setup` crea `.env` con un secreto JWT aleatorio y no sobrescribe archivos existentes. El repositorio incluye únicamente `.env.example`, con los campos de claves y contraseñas vacíos; la configuración real se mantiene fuera de Git. `config:gestor` completa la configuración S3 desde `../GestorDocumental/.env`, conserva MongoDB/JWT y las variables S3 ya configuradas, usa el prefijo propio `registro-visitas` y no imprime secretos. Para reemplazar deliberadamente la configuración S3 existente: `npm run config:gestor -- --replace-s3`. No tiene usuarios ni contraseñas por defecto.

Edite `.env` y configure:

- `MONGODB_URI`: por defecto usa el MongoDB existente en `127.0.0.1:27017`, base `registro_visitas`. También se admite `MONGO_URI`; `MONGODB_URI` tiene prioridad si se definen ambas.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `ADMIN_NAME`: para crear el primer administrador; contraseña de al menos 12 caracteres y máximo 72 bytes UTF-8.
- `PRIVACY_RESPONSIBLE` y `PRIVACY_CONTACT`: responsable y canal para derechos del titular. Esta oficina usa de forma predeterminada **Fastwaysas** y su contacto corporativo `https://www.fastwaysas.com/contacto | Tel. +57 314 300 2760`, definidos en `src/config/privacy.js`. Omitir las variables o dejarlas vacías conserva esos valores. Si se cambia el responsable por otra empresa, se debe configurar también su contacto; no se reutiliza el de Fastwaysas automáticamente.
- `CORS_ORIGINS`: orígenes exactos del frontend.
- `AWS_REGION`, `S3_BUCKET` y las credenciales `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, opcionalmente `AWS_SESSION_TOKEN`; también se admiten credenciales por rol/perfil del SDK. `S3_ENDPOINT` y `S3_FORCE_PATH_STYLE` permiten MinIO/S3 compatible. Para AWS estándar, deje `S3_ENDPOINT` vacío.

Después:

```powershell
npm run bootstrap:admin
npm run dev
```

Con la conexión predeterminada, `npm run dev` usa el MongoDB compartido de `27017`: no inicia ni reinicia ese servicio. La base y sus colecciones pertenecen únicamente a RegistroVisitas. No importa datos desde la antigua instancia de pruebas de `27019`.

Si MongoDB es standalone, RegistroVisitas usa operaciones coordinadas en su propia base. Si es replica set o mongos, conserva las transacciones nativas del driver. No ejecuta `replSetInitiate`, no edita el arranque de MongoDB ni crea otra instancia de producción.

La utilidad legada `mongo-dev.js` solo administra una instancia aislada si se configura explícitamente `127.0.0.1:27019` con `replicaSet=rs0`; ese destino ya no es predeterminado. `db:stop` nunca detiene el MongoDB compartido de `27017`. Con Atlas u otros destinos configurados tampoco inicia servicios locales.

Quite `ADMIN_PASSWORD` de `.env` después del bootstrap. El script no reemplaza usuarios ni reinicia contraseñas existentes. El inicio de sesión permite crear usuarios mediante `POST /api/usuarios` con el token del administrador.

Servidor: `http://localhost:3015`. Salud: `/health`. Disponibilidad de conexión: `/ready`. Contrato importable en Postman/Insomnia: `/openapi.json`.

Para comprobar la API después del despliegue consulte `/ready`. No se necesita modificar el servicio MongoDB ni S3.

### Operaciones en MongoDB standalone

La API coordina las escrituras y las lecturas de sus endpoints mediante un candado exclusivo dentro de **su propia base**. Antes de cada escritura conserva una imagen del documento anterior en un diario durable; ante errores confirmados revierte los cambios y la auditoría del intento. Los índices únicos y las claves de idempotencia siguen vigentes. También se coordinan las escrituras individuales de asociaciones WMS y el alta automática de la oficina. El registro de fotos mantiene sus fases separadas del envío a S3; no ejecuta escrituras S3 dentro de una compensación MongoDB.

Esto es coordinación de aplicación con compensaciones, **no una transacción ACID de MongoDB**. Serializa las operaciones de RegistroVisitas; una escritura larga puede provocar `503 OPERATION_BUSY`, que permite reintentar. Las escrituras directas desde Compass, otras aplicaciones o scripts ajenos no participan de ese control y no deben ejecutarse concurrentemente en las colecciones de esta API.

Las colecciones internas `_visitas_control`, `_visitas_operaciones` y `_visitas_deshacer` guardan únicamente el estado y las imágenes temporales necesarias para recuperar una operación; pueden contener datos privados del documento anterior y requieren los mismos controles de acceso y respaldo que las fichas. No contienen los bytes de fotos. Al terminar o revertir una operación se borran sus imágenes. Si falla esa limpieza se reintenta al siguiente arranque, sin exponer el diario por HTTP. Los registros necesarios para una recuperación pendiente nunca se purgan automáticamente.

Un candado pendiente **no se roba por tiempo**, porque el proceso anterior podría seguir escribiendo. Tras una interrupción del proceso o una escritura cuya respuesta es incierta, los endpoints de la aplicación se bloquean y `/ready` devuelve 503 hasta resolverla. Después de un arranque detectando una operación reciente de otra instancia, las peticiones pueden esperar o devolver `OPERATION_BUSY`; si está abandonada se exige recuperación. No se prometen disponibilidad automática ni recuperación sin intervención en esos casos.

Para inspeccionar una operación, sin iniciar la API ni cambiar datos:

```powershell
npm run db:recover
```

Para recuperarla: detener **todas las instancias de RegistroVisitas**, mantener MongoDB y S3 encendidos, ejecutar el script con el mismo entorno de la API y después iniciar la API nuevamente:

```powershell
npm run db:recover -- --apply --api-stopped
```

El script puede ejecutarse desde el checkout con Node o desde una ejecución puntual de la misma imagen de la API, con sus variables privadas y red. No necesita modificar MongoDB ni S3. Si una recuperación anterior también se interrumpió, detener además ese proceso antes de reintentar añadiendo `--retry-interrupted`. No limpiar manualmente el candado o el diario: se perdería la información necesaria para deshacer los cambios.

Pruebas sin abrir servidores: fijar `VISITAS_TEST_STANDALONE_URI=mongodb://127.0.0.1:27017/` y ejecutar `npm run test:standalone`. Se permite únicamente un destino local y una base aleatoria propia de la prueba; se elimina solo esa base. No se inicia ni reinicia MongoDB y las fotos usan un adaptador en memoria. Sin esa variable la prueba queda omitida. La prueba nativa `test/native-existing.integration.test.js` usa `VISITAS_TEST_REPLICA_URI` para un replica set local **ya encendido** en 27019 y tampoco inicia servidores.

### S3 de GestorDocumental

Se reutilizan el endpoint y las credenciales S3/MinIO de GestorDocumental, con un bucket propio `registro-de-visitas` y claves `registro-visitas/fotos/<uuid>.webp`. Las fotos anteriores en JPEG siguen siendo consultables. No se cambia la política de acceso de los buckets ni se publican objetos. Si configura otro bucket, debe existir y permitir acceso con las credenciales correspondientes.

Importar variables no inicia MinIO ni demuestra que S3 esté disponible. En la verificación de esta entrega el bucket respondió y se comprobó carga, lectura y eliminación con una imagen sintética; la lectura anónima devolvió 403. Para AWS estándar, deje `S3_ENDPOINT` vacío. Las claves no se imprimen ni se incluyen en el repositorio.

```powershell
npm run storage:check
```

La comprobación usa HeadBucket y no escribe objetos. La API puede iniciar con MongoDB aunque S3 esté apagado; las operaciones de fotos devolverán 503 con un mensaje del almacenamiento, sin guardar una copia local.

### Ejecutar también la API en Docker

El dominio previsto es `https://visitas.appfastway.com`. El proxy/Traefik debe terminar HTTPS con un certificado válido y dirigir el tráfico al puerto interno `3015` de la API, sin quitar el prefijo `/api`. Las comprobaciones públicas son `/health` y `/ready`. `503` del proxy no confirma que el proceso Node esté iniciado.

En el servidor se deben configurar de forma privada `JWT_SECRET`, `MONGODB_URI` (o `DOCKER_MONGODB_URI` para este Compose), S3 y `CORS_ORIGINS` con el origen HTTPS real del front. Si se accede desde WMS, configure `AUTH_MODE=both`, `WMS_AUTO_PROVISION=true` y `WMS_JWT_SECRET` con la clave del WMS de ese mismo entorno. No copie automáticamente el `.env` de desarrollo al servidor. El front debe compilarse con `VITE_VISITAS_API_URL=https://visitas.appfastway.com/api`.

```powershell
docker compose up -d --build
docker compose exec api npm run bootstrap:admin
```

Compose inicia únicamente la API; no crea otro MongoDB ni otro volumen de datos. En Docker Desktop usa `host.docker.internal:27017`, base `registro_visitas`, para llegar al MongoDB existente. `DOCKER_MONGODB_URI` permite configurar otro destino privado accesible desde el contenedor; en Linux debe configurarse según su red y no se debe asumir que `host.docker.internal` existe o que el loopback del host es accesible. El puerto de la API se publica solo en `127.0.0.1:3015` para un proxy HTTPS en el host. Si MinIO corre en el host, configure también su endpoint accesible desde Docker. `127.0.0.1` dentro del contenedor no apunta al host. El entorno real y las credenciales permanecen fuera de Git.

## Autenticación y permisos

Envíe `Authorization: Bearer <token>` en todas las rutas `/api`, excepto el login.

| Rol | Acceso |
| --- | --- |
| `admin` | Todos los módulos, usuarios, sedes y auditoría |
| `recepcion` | Visitantes, consentimientos, agenda con aprobación/pase automáticos, ingreso directo sin cita, entrada/salida y fotos; no ejecuta aprobaciones manuales de otros flujos |
| `anfitrion` | Crea fichas y agenda para cualquier receptor; consulta y administra citas que recibe o que creó, y sus propias solicitudes de visita; no accede al directorio completo de visitantes, fotos ni auditoría |

La cuenta se consulta en MongoDB en cada petición. Desactivar un usuario bloquea inmediatamente sus próximas peticiones. Actualmente los roles son globales para la organización; no hay permisos limitados por sede ni multitenencia.

### Integración opcional con WMS

`AUTH_MODE` puede ser `local`, `wms` o `both`. El modo inicial es `local`.

1. Configure `WMS_JWT_SECRET` mediante su entorno seguro. No se copiaron secretos de WMS.
2. Use `WMS_JWT_SUBJECT_CLAIM=id_usuario`, que corresponde al payload encontrado en `wmsBack`.
3. Cree o actualice un usuario local con `wmsId` igual a ese `id_usuario`, el rol de visitas adecuado y `activo: true`.
4. En modo `both` puede usar el JWT de WMS o el login local. En modo `wms`, el login local está deshabilitado; cree las asociaciones antes de activar ese modo.

La API valida firma, algoritmo HS256 y expiración. Puede fijar además `WMS_JWT_ISSUER` y `WMS_JWT_AUDIENCE` si WMS los emite. Los permisos proceden de la asociación local, nunca del rol enviado en el token WMS. Cambios/desactivaciones en WMS no se sincronizan automáticamente: también debe actualizarse la asociación local o esperar al vencimiento del token central.

La arquitectura es la misma de WMS, pero esta API no comparte su base de datos. `wmsIdExterno` permite vincular una ficha de visitante; todavía no consulta ni sincroniza el personal externo de WMS.

### Persona que recibe y agenda por asistentes

Con una sesión de WMS, `/api/usuarios/anfitriones` consulta el personal vigente mediante `GET /api/personal` de WMS y lo combina con los receptores locales. No exige que esas personas hayan abierto antes Control de visitas. Configurar `WMS_API_URL` con la base de WMS **incluyendo `/api`**; producción predeterminada: `https://api.appfastway.com/api`, desarrollo: `http://127.0.0.1:3000/api`. La consulta usa el JWT WMS de la petición, con tiempo límite y sin reenviarlo en redirecciones. No necesita credenciales nuevas ni cambios en WMS, MongoDB o S3. Si WMS falla, devuelve receptores locales y un aviso visible para no presentar esa lista como completa.

Solo se guarda la asociación del receptor seleccionado, sin contraseña ni acceso implícito al módulo (`soloDirectorio: true`). Su entrada futura requiere los permisos de visitas firmados que ya existían; la provisión automática conserva la misma asociación. Personal retirado no se incorpora desde el directorio. Los roles `recepcion` también pueden recibir visitas. El asistente con `visitasAgendar` puede elegir otro receptor, consultar las citas que creó y compartir sus pases; el receptor también ve esas citas. Un tercero conserva la restricción de lectura. Los permisos de entrada, salida, correcciones y administración se mantienen.

## Flujos de uso

### Entrada con cita

1. Crear o buscar visitante con `POST /api/visitantes` o `GET /api/visitantes?documento=...`.
2. Consultar `/api/usuarios/anfitriones` y `/api/sedes`.
3. Crear cita con `POST /api/citas`. Queda `aprobada` y devuelve `{ data: [cita], serieId?, pases: [{ cita, invitacion, token, qrDataUrl, finProgramado }] }`. Cada fecha repetida tiene su propio pase. La creación, aprobación automática, hash del pase y auditoría se guardan en la misma operación protegida; la respuesta nunca expone el hash y el token no se almacena en texto. El permiso de agendar incluye esta aprobación automática; un anfitrión sigue limitado a sus propias citas.
4. El frontend abre inmediatamente la tarjeta del pase para compartir, descargar o copiar el mensaje. En recurrencias permite recorrer cada fecha. `POST /api/citas/:id/aprobar` permanece para citas pendientes anteriores o reprogramadas.
5. Para renovar un pase, `POST /api/citas/:id/pase` devuelve `token`, `qrDataUrl` (PNG base64), `finProgramado`, cita e invitación. El fin es una referencia de horario, no una caducidad automática. El token solo se guarda como hash. Emitir otro pase invalida el anterior. El envío al visitante lo gestiona la aplicación consumidora.
6. Recepción escanea el QR y llama a `POST /api/citas/validar-pase` con `{ "token": "..." }`. Esto consulta la cita sin consumir el pase.
7. Presentar el texto vigente de `/api/consentimientos/politica` y registrar la aceptación del visitante en `POST /api/consentimientos` para `registro_visitas`. No se debe registrar aceptación sin manifestación del titular.
8. Verificar visualmente el documento de la persona. Confirmar `POST /api/visitas/entrada` con `token` **o** `cita`, `identidadVerificada: true` y cabecera `Idempotency-Key` UUID. Conservar la misma clave y el mismo cuerpo para reintentar una petición por problemas de red.
9. Registrar `POST /api/visitas/:id/salida`.

La entrada consume el pase y cambia la cita a `ingresada`, dentro de la misma operación protegida que crea la visita y la auditoría. La salida finaliza ambas. Un índice impide más de una visita `dentro` para una persona, incluso con peticiones concurrentes o sedes distintas. Una clave de idempotencia reutilizada con otro contenido o por otro operador devuelve 409.

El horario no bloquea el ingreso de una cita aprobada: llegar antes o tarde devuelve `valido: true` y `avisoHorario` con tipo, minutos de diferencia desde el inicio y mensaje para recepción. La entrada deja ese aviso en los eventos de la visita y la cita. El QR sigue requiriendo cita aprobada, referencias activas, identidad verificada y consentimiento; se consume una sola vez. Cancelar, reprogramar, corregir la identidad o marcar ausencia revoca el pase. Se pueden generar pases de citas aprobadas aunque haya pasado su horario. `APPOINTMENT_LATE_MINUTES` solo mantiene el margen para marcar manualmente no asistencia; `APPOINTMENT_EARLY_MINUTES` queda como compatibilidad de configuración y no limita las entradas.

### Entrada sin cita

Recepción o administración registra directamente mediante `POST /api/visitas/ingreso-directo`: `visitante`, `motivo`, `identidadVerificada: true` y cabecera UUID `Idempotency-Key`. La oficina se asigna automáticamente; anfitrión, área, equipos y observaciones son opcionales. Requiere consentimiento vigente para el registro. En una operación protegida se crea la visita en estado `dentro` y la auditoría `entrada_sin_cita`, atribuida al operador de recepción; no crea cita ni solicitud y no atribuye aprobación al anfitrión. Al retirarse se usa `POST /api/visitas/:id/salida`.

Conservar la misma clave y cuerpo si se pierde la respuesta. El reintento recupera la misma visita; otra clave no puede crear dos visitas activas para la misma persona. Reutilizar la clave con otro cuerpo u operador devuelve 409. Si la visita ya tiene salida, el reintento devuelve su estado final y no la vuelve a ingresar.

Se conservan, para solicitudes existentes u otras integraciones, `POST /api/visitas` → `/api/visitas/:id/autorizar` o `/rechazar` → `/api/visitas/:id/entrada`. El frontend de ingreso sin cita utiliza el registro directo y no recorre esas solicitudes.

Repetir entrada o salida de la misma visita no duplica la marcación. Un rechazo o una visita finalizada no puede volver a marcar entrada.

### Agenda, recurrencias e historial

- `GET /api/citas?desde=...&hasta=...&sede=...&estado=...`: agenda; anfitriones solo ven sus citas.
- Las consultas de agenda incluyen referencias con nombres de visitante, sede y anfitrión; no exponen fotografías ni el directorio completo de visitantes.
- `PATCH /api/citas/:id/reprogramar`: nuevas fechas; vuelve a `pendiente`, requiere nueva aprobación y revoca el pase.
- `POST /api/citas/:id/cancelar`: cancela y revoca el pase.
- `POST /api/citas/:id/no-asistio`: disponible después de terminar la ventana de ingreso. No se ejecuta automáticamente.
- `repeticion: { "cantidad": 4, "cadaSemanas": 1 }` crea de 2 a 30 citas en una operación protegida, cada 1 a 4 semanas. Cada ocurrencia se aprueba, cancela o reprograma individualmente.
- La recurrencia suma semanas en UTC; preserva el horario de Colombia. Para zonas con cambio estacional se necesitaría ampliar la generación para conservar la hora local.
- `GET /api/visitas?estado=dentro`: personas actualmente en las oficinas.
- `GET /api/visitas/resumen`: cantidades por estado, acumuladas sobre el historial.
- `GET /api/visitantes/:id/historial`: historial paginado por persona.
- `GET /api/auditoria?entidad=visitas&entidadId=...`: trazabilidad administrativa.

Filtros de citas/visitas: `visitante`, `sede`, `anfitrion`, `estado`, `desde`, `hasta`. Las citas filtran por inicio programado y las visitas por fecha de creación. Las listas admiten `page` (1 por defecto), `limit` (25 por defecto, máximo 100). Las fechas de creación/reprogramación exigen ISO 8601 con zona horaria, por ejemplo `2026-11-04T09:00:00-05:00`; se almacenan en UTC.

## Fotografías y datos personales

`POST /api/archivos` usa `multipart/form-data` con `archivo`, `visitante`, `tipo` (`foto_rostro` o `foto_documento`) y opcionalmente `visita`. Exige autorización vigente específica para ese tipo de foto, separada de `registro_visitas`.

- La foto es opcional: el flujo de ingreso funciona sin fotos y no hace reconocimiento facial.
- JPEG, PNG o WebP, sin animación, máximo 5 MiB por defecto y 20 megapíxeles.
- Se verifica y decodifica el contenido real, se corrige orientación y se elimina EXIF. La nueva salida es WebP: rostro hasta 720 × 720, calidad 60; documento hasta 1440 × 1440, calidad 72, manteniendo la proporción y sin ampliar imágenes pequeñas. Los documentos conservan más resolución que los rostros para facilitar su lectura.
- La salida no supera 256 KiB por defecto. Si hace falta, se intenta reducir de nuevo sobre la imagen ya pequeña, hasta dos veces. Si no cumple el límite sin bajar más de la calidad mínima, devuelve 422 y pide recortar/repetir la foto; no guarda el original ni una copia local.
- MongoDB conserva tamaño original, tamaño final, dimensiones y calidad para poder medir el ahorro real. La reducción depende de la foto; no se garantiza un porcentaje fijo ni legibilidad automática.
- Memoria: una carga completa a la vez por proceso, desde antes de Multer hasta finalizar S3; si está ocupado responde 503 `PHOTO_BUSY` con `Retry-After: 2`. No se encolan archivos completos en RAM. Sharp usa un hilo, lectura secuencial y caché desactivada. Se libera la referencia al original antes de operar con Mongo/S3 y las descargas S3 se transmiten por flujo con contrapresión, sin concatenarlas completas en la API. La entrada sí utiliza un buffer acotado por `MAX_UPLOAD_MB` y la decodificación utiliza memoria adicional; no es un procesamiento sin RAM.
- Los bytes se procesan en memoria y se envían a S3, sin temporales ni respaldo local. MongoDB conserva bucket, clave, versión si existe, hash, tamaño y estado de la carga. Las cargas pendientes o fallidas no se publican.
- Los archivos no se publican como carpeta estática ni enlaces públicos. `GET /api/archivos/:id/contenido` exige permiso, consentimiento vigente y fecha de conservación válida; lee la foto desde S3, registra auditoría y devuelve `Cache-Control: private, no-store`.
- El listado no devuelve rutas físicas ni nombres originales de archivos. Las rutas usan UUID generados por el servidor.
- `DELETE /api/archivos/:id` bloquea acceso y elimina el objeto S3 (la versión registrada, si el bucket usa versionado). Si S3 falla, la tarea de limpieza puede reintentar. Las políticas del proveedor para versiones anteriores, réplicas o respaldos deben acompañar la conservación definida por la organización.
- `POST /api/consentimientos/:id/revocar` revoca ese registro de autorización y bloquea las imágenes asociadas a él. Si hay varias autorizaciones vigentes para la misma finalidad, deben revocarse los registros correspondientes.

Ejecute periódicamente, mediante el planificador que use su infraestructura:

```powershell
npm run purge:files
```

La limpieza elimina objetos S3 de fotos vencidas, asociadas a consentimientos revocados, marcadas para eliminar o cargas pendientes interrumpidas de más de una hora. Cada carga registra su intención antes de enviar bytes; no se recorre ni se borra contenido ajeno en el bucket compartido. Si hay eliminaciones pendientes, el script devuelve código de salida 1 para que el planificador pueda reintentarlo. El acceso se bloquea por vencimiento/revocación aunque la limpieza aún no se haya ejecutado. No se creó ninguna tarea programada.

`PHOTO_RETENTION_DAYS=90` es una propuesta configurable, no un plazo legal obligatorio. La organización debe definir y justificar sus plazos. El historial, las fichas y la auditoría no tienen borrado automático en esta versión; la atención de solicitudes de supresión y la política de conservación del historial requieren un procedimiento administrativo propio.

Los consentimientos conservan texto, versión, responsable, contacto, finalidad, medio, evidencia, fecha y operador. El texto incluido es una base técnica y debe revisarse antes de uso real. La auditoría general guarda identificadores y acciones, sin contraseñas, fotografías ni cuerpos completos de solicitudes.

## Flexibilidad de MongoDB

Los datos principales tienen esquema, tipos, longitudes, referencias e índices. `atributos` del visitante permite hasta 30 campos adicionales de texto con claves simples; por ejemplo `{ "categoria": "proveedor", "especialidad": "redes" }`. Evita cambiar el esquema por cada dato auxiliar sin aceptar contenido arbitrario ni operadores MongoDB.

El documento de identidad se normaliza a mayúsculas y no admite espacios/puntos; se conserva como texto. La pareja tipo/número es única. El PATCH general no permite cambiar tipo, número, nombres ni apellidos. Solo administración puede usar `POST /api/visitantes/{id}/correcciones` con `anterior`, `correccion` (los cuatro campos de identidad completos), `motivo` y `requestKey` UUID v4. La operación verifica la ficha anterior, impide documentos duplicados y guarda antes/después, autor y fecha en la misma operación protegida que actualiza ficha, visitas abiertas y auditoría. Las visitas cerradas conservan su identidad original. Los pases existentes se revocan y deben generarse nuevamente. `GET /api/visitantes/{id}/correcciones` lista el historial para administración. Un reintento conserva cuerpo y clave; reutilizarla con otros datos devuelve 409. La emisión de pases se serializa con la corrección del visitante y devuelve `invitacion` con nombre actual, anfitrión y fechas para la tarjeta compartible del frontend.

## Vehículo opcional por visita

En el ingreso directo, con cita o de una solicitud autorizada se admite `vehiculo: { "placa": "ABC123", "descripcion": "Moto negra" }`. Placa y descripción son opcionales; enviar `{}` registra la presencia del vehículo sin exigirlos. Omitir el campo conserva el flujo sin vehículo. El servidor devuelve `presente: true` cuando lo registra. La placa se guarda como texto en mayúsculas, sin espacios ni guiones; admite entre 3 y 12 letras/números, sin asumir un único formato de placa. El vehículo pertenece al movimiento de visita y conserva las mismas horas de entrada y salida. Las visitas anteriores no se modifican.

Las fotografías `foto_vehiculo` y `foto_placa` son independientes y opcionales. Requieren su autorización específica, `visita` y un vehículo registrado en esa misma visita y para el mismo visitante. Usan S3 privado, revocación y vencimiento como las demás fotos. Se comprimen secuencialmente a WebP con el perfil de documento (hasta 1440 px y 256 KB por defecto), sin EXIF ni almacenamiento local; se mantiene el límite global de una foto procesándose a la vez. `GET /api/archivos?visitante=...&visita=...` permite consultar solo los adjuntos de ese movimiento.

El hash de idempotencia incluye el vehículo cuando se envía: cambiar placa o descripción conservando la misma clave se rechaza. Las peticiones antiguas sin vehículo conservan su hash. En una solicitud aún autorizada, `vehiculo: null` al confirmar la entrada retira un vehículo indicado previamente.

`npm run test:vehiculos` verifica validadores, modelos, reintentos, S3 con adaptadores aislados y compresión real; no inicia MongoDB ni servidores ni sube fotos a un bucket real.

## Validación

```powershell
npm run check
npm test
npm audit
```

Las pruebas crean un replica set temporal, verifican permisos y asociación WMS, agenda, recurrencias, pases, entradas concurrentes/idempotentes, salida, historial, consentimiento, fotos privadas en S3, revocación, fallos del almacenamiento y auditoría. El adaptador S3 se prueba con un cliente aislado, sin subir imágenes a buckets reales. No usan ni vacían bases existentes. En este Windows detectan el MongoDB instalado en `C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe`; puede establecer `MONGOMS_SYSTEM_BINARY` para otra ruta. Si no hay binario, la herramienta de pruebas lo descarga.

## Alcance de esta entrega

Incluye el backend, pruebas, documentación, configuración y ejemplos HTTP. El frontend está en `FrontWms`, con captura móvil, PDF417, OCR local y tarjeta QR para compartir manualmente. No incluye lectura del QR encriptado de la cédula nueva, comparación biométrica, envíos automáticos por correo/WhatsApp, puertas físicas ni notificaciones al anfitrión. El QR de citas es un pase de ingreso; el escaneo del documento no certifica su autenticidad.

### Datos opcionales del documento

PATCH /api/visitantes/{id}/datos-documento permite a administración y recepción guardar datosDocumento, aceptado: true y version vigente. Admite fechaNacimiento y fechaExpedicion como fechas civiles YYYY-MM-DD, sexo F/M/X, grupoSanguineo, estaturaCm, lugarNacimiento, lugarExpedicion y codigoLugarNacimiento. Ningún campo biográfico adicional es obligatorio para ingresar. Guarda una autorización expresa datos_documento en la misma operación protegida; la búsqueda mínima de identidad no expone esos campos y revocar la finalidad los elimina de la ficha. No se reciben huellas ni el código PDF417 crudo. Ver el esquema DatosDocumento de OpenAPI y FrontWms/docs/control-visitas.md.
