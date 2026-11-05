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

Requiere Node.js 20.19 o superior (Node 22 recomendado), MongoDB en replica set y almacenamiento S3/MinIO para fotos. Un MongoDB standalone no admite las transacciones de esta API. También funciona con MongoDB Atlas. Nunca guarda fotografías en disco local.

Desde PowerShell, en esta carpeta:

```powershell
npm ci
npm run setup
npm run config:gestor
```

`setup` crea `.env` con un secreto JWT aleatorio y no sobrescribe archivos existentes. El repositorio incluye únicamente `.env.example`, con los campos de claves y contraseñas vacíos; la configuración real se mantiene fuera de Git. `config:gestor` completa la configuración S3 desde `../GestorDocumental/.env`, conserva MongoDB/JWT y las variables S3 ya configuradas, usa el prefijo propio `registro-visitas` y no imprime secretos. Para reemplazar deliberadamente la configuración S3 existente: `npm run config:gestor -- --replace-s3`. No tiene usuarios ni contraseñas por defecto.

Edite `.env` y configure:

- `MONGODB_URI`: por defecto apunta al MongoDB de Compose en `127.0.0.1:27019`.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `ADMIN_NAME`: para crear el primer administrador; contraseña de al menos 12 caracteres y máximo 72 bytes UTF-8.
- `PRIVACY_RESPONSIBLE` y `PRIVACY_CONTACT`: responsable y canal para derechos del titular. Esta oficina usa de forma predeterminada **Fastwaysas** y su contacto corporativo `https://www.fastwaysas.com/contacto | Tel. +57 314 300 2760`, definidos en `src/config/privacy.js`. Omitir las variables o dejarlas vacías conserva esos valores. Si se cambia el responsable por otra empresa, se debe configurar también su contacto; no se reutiliza el de Fastwaysas automáticamente.
- `CORS_ORIGINS`: orígenes exactos del frontend.
- `AWS_REGION`, `S3_BUCKET` y las credenciales `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, opcionalmente `AWS_SESSION_TOKEN`; también se admiten credenciales por rol/perfil del SDK. `S3_ENDPOINT` y `S3_FORCE_PATH_STYLE` permiten MinIO/S3 compatible. Para AWS estándar, deje `S3_ENDPOINT` vacío.

Después:

```powershell
npm run db:dev
npm run bootstrap:admin
npm run dev
```

`npm run dev` ejecuta automáticamente la preparación de MongoDB local antes de nodemon. Detecta `mongod` en PATH o en la instalación de MongoDB Server de Windows; puede fijar `MONGOD_PATH`. Solo inicia una instancia privada de desarrollo en `127.0.0.1:27019` con replica set `rs0`, persistiendo sus datos en `.local/mongo`. No modifica ni reinicia el MongoDB de otros proyectos en `27017`. Si el puerto ya pertenece a otra instancia incompatible, se detiene sin modificarla. Para detener exclusivamente la instancia propia: `npm run db:stop`.

Si usa Atlas/otro servidor configurado en `MONGODB_URI`, predev no inicia servicios locales. Alternativa con Docker: `docker compose up -d mongo`; después `npm run dev` reutiliza esa instancia compatible. El MongoDB de desarrollo sigue disponible al cerrar nodemon; los datos no se eliminan.

Quite `ADMIN_PASSWORD` de `.env` después del bootstrap. El script no reemplaza usuarios ni reinicia contraseñas existentes. El inicio de sesión permite crear usuarios mediante `POST /api/usuarios` con el token del administrador.

Servidor: `http://localhost:3015`. Salud: `/health`. Disponibilidad de conexión: `/ready`. Contrato importable en Postman/Insomnia: `/openapi.json`.

Se verificó el arranque de la instancia local propia en el puerto 27019. No se creó un administrador real ni se modificó el MongoDB existente en 27017.

### S3 de GestorDocumental

Se reutilizan el endpoint y las credenciales S3/MinIO de GestorDocumental, con un bucket propio `registro-de-visitas` y claves `registro-visitas/fotos/<uuid>.webp`. Las fotos anteriores en JPEG siguen siendo consultables. No se cambia la política de acceso de los buckets ni se publican objetos. Si configura otro bucket, debe existir y permitir acceso con las credenciales correspondientes.

Importar variables no inicia MinIO ni demuestra que S3 esté disponible. En la verificación de esta entrega el bucket respondió y se comprobó carga, lectura y eliminación con una imagen sintética; la lectura anónima devolvió 403. Para AWS estándar, deje `S3_ENDPOINT` vacío. Las claves no se imprimen ni se incluyen en el repositorio.

```powershell
npm run storage:check
```

La comprobación usa HeadBucket y no escribe objetos. La API puede iniciar con MongoDB aunque S3 esté apagado; las operaciones de fotos devolverán 503 con un mensaje del almacenamiento, sin guardar una copia local.

### Ejecutar también la API en Docker

```powershell
docker compose --profile api up -d --build
docker compose --profile api exec api npm run bootstrap:admin
```

Compose conserva un volumen únicamente para MongoDB; las fotos están en S3. La definición incluida es para desarrollo local; MongoDB solo se publica por loopback. Si MinIO corre en el host, configure un endpoint accesible desde el contenedor (por ejemplo `host.docker.internal` en Docker Desktop); `127.0.0.1` dentro del contenedor no apunta al host. Para producción configure autenticación/TLS de MongoDB, HTTPS, copias de seguridad, un bucket privado y el acceso de red según su infraestructura. No exponga el MongoDB de desarrollo en Internet.

## Autenticación y permisos

Envíe `Authorization: Bearer <token>` en todas las rutas `/api`, excepto el login.

| Rol | Acceso |
| --- | --- |
| `admin` | Todos los módulos, usuarios, sedes y auditoría |
| `recepcion` | Visitantes, consentimientos, agenda con aprobación/pase automáticos, ingreso directo sin cita, entrada/salida y fotos; no ejecuta aprobaciones manuales de otros flujos |
| `anfitrion` | Crea fichas de visitantes; consulta y administra exclusivamente sus propias citas y visitas; no tiene acceso al directorio completo de visitantes, fotos ni auditoría |

La cuenta se consulta en MongoDB en cada petición. Desactivar un usuario bloquea inmediatamente sus próximas peticiones. Actualmente los roles son globales para la organización; no hay permisos limitados por sede ni multitenencia.

### Integración opcional con WMS

`AUTH_MODE` puede ser `local`, `wms` o `both`. El modo inicial es `local`.

1. Configure `WMS_JWT_SECRET` mediante su entorno seguro. No se copiaron secretos de WMS.
2. Use `WMS_JWT_SUBJECT_CLAIM=id_usuario`, que corresponde al payload encontrado en `wmsBack`.
3. Cree o actualice un usuario local con `wmsId` igual a ese `id_usuario`, el rol de visitas adecuado y `activo: true`.
4. En modo `both` puede usar el JWT de WMS o el login local. En modo `wms`, el login local está deshabilitado; cree las asociaciones antes de activar ese modo.

La API valida firma, algoritmo HS256 y expiración. Puede fijar además `WMS_JWT_ISSUER` y `WMS_JWT_AUDIENCE` si WMS los emite. Los permisos proceden de la asociación local, nunca del rol enviado en el token WMS. Cambios/desactivaciones en WMS no se sincronizan automáticamente: también debe actualizarse la asociación local o esperar al vencimiento del token central.

La arquitectura es la misma de WMS, pero esta API no comparte su base de datos. `wmsIdExterno` permite vincular una ficha de visitante; todavía no consulta ni sincroniza el personal externo de WMS.

## Flujos de uso

### Entrada con cita

1. Crear o buscar visitante con `POST /api/visitantes` o `GET /api/visitantes?documento=...`.
2. Consultar `/api/usuarios/anfitriones` y `/api/sedes`.
3. Crear cita con `POST /api/citas`. Queda `aprobada` y devuelve `{ data: [cita], serieId?, pases: [{ cita, invitacion, token, qrDataUrl, finProgramado }] }`. Cada fecha repetida tiene su propio pase. La creación, aprobación automática, hash del pase y auditoría se guardan en la misma transacción; la respuesta nunca expone el hash y el token no se almacena en texto. El permiso de agendar incluye esta aprobación automática; un anfitrión sigue limitado a sus propias citas.
4. El frontend abre inmediatamente la tarjeta del pase para compartir, descargar o copiar el mensaje. En recurrencias permite recorrer cada fecha. `POST /api/citas/:id/aprobar` permanece para citas pendientes anteriores o reprogramadas.
5. Para renovar un pase, `POST /api/citas/:id/pase` devuelve `token`, `qrDataUrl` (PNG base64), `finProgramado`, cita e invitación. El fin es una referencia de horario, no una caducidad automática. El token solo se guarda como hash. Emitir otro pase invalida el anterior. El envío al visitante lo gestiona la aplicación consumidora.
6. Recepción escanea el QR y llama a `POST /api/citas/validar-pase` con `{ "token": "..." }`. Esto consulta la cita sin consumir el pase.
7. Presentar el texto vigente de `/api/consentimientos/politica` y registrar la aceptación del visitante en `POST /api/consentimientos` para `registro_visitas`. No se debe registrar aceptación sin manifestación del titular.
8. Verificar visualmente el documento de la persona. Confirmar `POST /api/visitas/entrada` con `token` **o** `cita`, `identidadVerificada: true` y cabecera `Idempotency-Key` UUID. Conservar la misma clave y el mismo cuerpo para reintentar una petición por problemas de red.
9. Registrar `POST /api/visitas/:id/salida`.

La entrada consume el pase y cambia la cita a `ingresada`, dentro de la misma transacción que crea la visita y la auditoría. La salida finaliza ambas. Un índice impide más de una visita `dentro` para una persona, incluso con peticiones concurrentes o sedes distintas. Una clave de idempotencia reutilizada con otro contenido o por otro operador devuelve 409.

El horario no bloquea el ingreso de una cita aprobada: llegar antes o tarde devuelve `valido: true` y `avisoHorario` con tipo, minutos de diferencia desde el inicio y mensaje para recepción. La entrada deja ese aviso en los eventos de la visita y la cita. El QR sigue requiriendo cita aprobada, referencias activas, identidad verificada y consentimiento; se consume una sola vez. Cancelar, reprogramar, corregir la identidad o marcar ausencia revoca el pase. Se pueden generar pases de citas aprobadas aunque haya pasado su horario. `APPOINTMENT_LATE_MINUTES` solo mantiene el margen para marcar manualmente no asistencia; `APPOINTMENT_EARLY_MINUTES` queda como compatibilidad de configuración y no limita las entradas.

### Entrada sin cita

Recepción o administración registra directamente mediante `POST /api/visitas/ingreso-directo`: `visitante`, `motivo`, `identidadVerificada: true` y cabecera UUID `Idempotency-Key`. La oficina se asigna automáticamente; anfitrión, área, equipos y observaciones son opcionales. Requiere consentimiento vigente para el registro. En una transacción se crea la visita en estado `dentro` y la auditoría `entrada_sin_cita`, atribuida al operador de recepción; no crea cita ni solicitud y no atribuye aprobación al anfitrión. Al retirarse se usa `POST /api/visitas/:id/salida`.

Conservar la misma clave y cuerpo si se pierde la respuesta. El reintento recupera la misma visita; otra clave no puede crear dos visitas activas para la misma persona. Reutilizar la clave con otro cuerpo u operador devuelve 409. Si la visita ya tiene salida, el reintento devuelve su estado final y no la vuelve a ingresar.

Se conservan, para solicitudes existentes u otras integraciones, `POST /api/visitas` → `/api/visitas/:id/autorizar` o `/rechazar` → `/api/visitas/:id/entrada`. El frontend de ingreso sin cita utiliza el registro directo y no recorre esas solicitudes.

Repetir entrada o salida de la misma visita no duplica la marcación. Un rechazo o una visita finalizada no puede volver a marcar entrada.

### Agenda, recurrencias e historial

- `GET /api/citas?desde=...&hasta=...&sede=...&estado=...`: agenda; anfitriones solo ven sus citas.
- Las consultas de agenda incluyen referencias con nombres de visitante, sede y anfitrión; no exponen fotografías ni el directorio completo de visitantes.
- `PATCH /api/citas/:id/reprogramar`: nuevas fechas; vuelve a `pendiente`, requiere nueva aprobación y revoca el pase.
- `POST /api/citas/:id/cancelar`: cancela y revoca el pase.
- `POST /api/citas/:id/no-asistio`: disponible después de terminar la ventana de ingreso. No se ejecuta automáticamente.
- `repeticion: { "cantidad": 4, "cadaSemanas": 1 }` crea de 2 a 30 citas en una transacción, cada 1 a 4 semanas. Cada ocurrencia se aprueba, cancela o reprograma individualmente.
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

Ejecute periódicamente, mediante el programador que use su infraestructura:

```powershell
npm run purge:files
```

La limpieza elimina objetos S3 de fotos vencidas, asociadas a consentimientos revocados, marcadas para eliminar o cargas pendientes interrumpidas de más de una hora. Cada carga registra su intención antes de enviar bytes; no se recorre ni se borra contenido ajeno en el bucket compartido. Si hay eliminaciones pendientes, el script devuelve código de salida 1 para que el programador pueda reintentarlo. El acceso se bloquea por vencimiento/revocación aunque la limpieza aún no se haya ejecutado. No se creó ninguna tarea programada.

`PHOTO_RETENTION_DAYS=90` es una propuesta configurable, no un plazo legal obligatorio. La organización debe definir y justificar sus plazos. El historial, las fichas y la auditoría no tienen borrado automático en esta versión; la atención de solicitudes de supresión y la política de conservación del historial requieren un procedimiento administrativo propio.

Los consentimientos conservan texto, versión, responsable, contacto, finalidad, medio, evidencia, fecha y operador. El texto incluido es una base técnica y debe revisarse antes de uso real. La auditoría general guarda identificadores y acciones, sin contraseñas, fotografías ni cuerpos completos de solicitudes.

## Flexibilidad de MongoDB

Los datos principales tienen esquema, tipos, longitudes, referencias e índices. `atributos` del visitante permite hasta 30 campos adicionales de texto con claves simples; por ejemplo `{ "categoria": "proveedor", "especialidad": "redes" }`. Evita cambiar el esquema por cada dato auxiliar sin aceptar contenido arbitrario ni operadores MongoDB.

El documento de identidad se normaliza a mayúsculas y no admite espacios/puntos; se conserva como texto. La pareja tipo/número es única. El PATCH general no permite cambiar tipo, número, nombres ni apellidos. Solo administración puede usar `POST /api/visitantes/{id}/correcciones` con `anterior`, `correccion` (los cuatro campos de identidad completos), `motivo` y `requestKey` UUID v4. La operación verifica la ficha anterior, impide documentos duplicados y guarda antes/después, autor y fecha en la misma transacción que actualiza ficha, visitas abiertas y auditoría. Las visitas cerradas conservan su identidad original. Los pases existentes se revocan y deben generarse nuevamente. `GET /api/visitantes/{id}/correcciones` lista el historial para administración. Un reintento conserva cuerpo y clave; reutilizarla con otros datos devuelve 409. La emisión de pases se serializa con la corrección del visitante y devuelve `invitacion` con nombre actual, anfitrión y fechas para la tarjeta compartible del frontend.

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

PATCH /api/visitantes/{id}/datos-documento permite a administración y recepción guardar datosDocumento, aceptado: true y version vigente. Admite fechaNacimiento y fechaExpedicion como fechas civiles YYYY-MM-DD, sexo F/M/X, grupoSanguineo, estaturaCm, lugarNacimiento, lugarExpedicion y codigoLugarNacimiento. Ningún campo biográfico adicional es obligatorio para ingresar. Guarda una autorización expresa datos_documento en la misma transacción; la búsqueda mínima de identidad no expone esos campos y revocar la finalidad los elimina de la ficha. No se reciben huellas ni el código PDF417 crudo. Ver el esquema DatosDocumento de OpenAPI y FrontWms/docs/control-visitas.md.
