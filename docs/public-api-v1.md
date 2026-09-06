# API pública v1

La API pública v1 permite integrar Merca Booking con sitios externos como Webflow. Actualmente cubre el vertical hotelero.

## URL base

    /api/public/v1

En producción debe anteponerse el dominio donde se encuentre desplegado Merca Booking.

## Endpoints

| Método | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/businesses/{businessSlug}` | Información pública y modalidades de pago |
| `GET` | `/businesses/{businessSlug}/availability` | Disponibilidad y precios |
| `POST` | `/businesses/{businessSlug}/reservations` | Crear una reserva pública |
| `OPTIONS` | Los endpoints anteriores | Preflight CORS |

## Negocio y modalidades de pago

Solicitud:

    GET /api/public/v1/businesses/hotel-demo

La respuesta contiene información pública del negocio y `paymentOptions`. El frontend debe mostrar únicamente las modalidades incluidas en ese arreglo.

## Disponibilidad

Solicitud:

    GET /api/public/v1/businesses/hotel-demo/availability?checkIn=2026-09-10&checkOut=2026-09-12&adults=2&children=0

Parámetros:

| Parámetro | Requerido | Descripción |
| --- | --- | --- |
| `checkIn` | Sí | Entrada con formato `YYYY-MM-DD` |
| `checkOut` | Sí | Salida con formato `YYYY-MM-DD` |
| `adults` | No | Adultos; predeterminado: `1` |
| `children` | No | Niños; predeterminado: `0` |

El período máximo es de 31 noches. La respuesta incluye servicios activos compatibles, inventario y precios calculados por el servidor.

## Crear una reserva

Cabeceras:

    POST /api/public/v1/businesses/hotel-demo/reservations
    Content-Type: application/json
    Idempotency-Key: 123e4567-e89b-42d3-a456-426614174000

Cuerpo:

    {
      "serviceId": "service-id",
      "firstName": "Ana",
      "lastName": "Ejemplo",
      "email": "ana@example.com",
      "phone": "+50370000000",
      "checkIn": "2026-09-10",
      "checkOut": "2026-09-12",
      "adults": 2,
      "children": 0,
      "paymentOption": "FULL",
      "specialRequests": "Habitación alejada del ascensor.",
      "options": [],
      "turnstileToken": "token-generado-por-cloudflare"
    }

Debe proporcionarse al menos `email` o `phone`.

Cada elemento de `options` admite:

    {
      "serviceOptionId": "service-option-id",
      "optionalQuantity": 1,
      "startAt": "2026-09-10T21:00:00.000Z",
      "endAt": "2026-09-12T18:00:00.000Z"
    }

`startAt` y `endAt` son opcionales, pero deben enviarse juntos.

## Contrato estricto

El cliente no puede enviar campos administrativos o calculados, entre ellos:

- `businessId`;
- `customerId`;
- `source`;
- `status`;
- precios, subtotales o totales;
- usuarios internos;
- asignaciones de recursos.

El servidor fija `source` como `WEBSITE` y calcula precios, inventario, disponibilidad y vencimiento.

## Respuesta correcta

Una reserva nueva devuelve `201 Created`, `replayed: false` y un `confirmationCode`.

Una repetición válida devuelve `200 OK`:

    {
      "success": true,
      "idempotency": {
        "key": "123e4567-e89b-42d3-a456-426614174000",
        "replayed": true
      },
      "reservation": {
        "confirmationCode": "MB-12345678",
        "status": "PENDING"
      }
    }

La respuesta completa incluye estancia, huéspedes, servicios, opciones, precios y pago requerido. No expone identificadores internos de la reserva, cliente o recursos.

## Idempotencia

`Idempotency-Key` es obligatorio y debe contener un UUID.

- La primera solicitud válida devuelve `201`.
- La misma clave y los mismos datos devuelven `200`.
- La misma clave con datos distintos devuelve `409 IDEMPOTENCY_KEY_REUSED`.
- Una reserva nueva o modificada debe utilizar una clave nueva.

El token de Turnstile no forma parte del fingerprint. Ante un resultado desconocido por un problema de red, el cliente puede generar un token nuevo y reenviar los mismos datos con la misma clave.

## Turnstile

El sitio externo debe generar el token usando la acción:

    create_reservation

En producción el servidor valida el resultado de Siteverify, la acción y el hostname permitido.

Variables requeridas:

    PUBLIC_API_IDEMPOTENCY_SECRET=<valor-aleatorio-de-al-menos-32-caracteres>
    TURNSTILE_SECRET_KEY=<clave-secreta-de-cloudflare>
    TURNSTILE_EXPECTED_ACTION=create_reservation
    TURNSTILE_ALLOWED_HOSTNAMES=reservas.example.com,www.example.com

Los hostnames se escriben sin protocolo, puerto ni ruta.

Para pruebas locales puede utilizarse:

    TURNSTILE_TEST_MODE=true

Este modo solo tiene efecto cuando `NODE_ENV` no es `production`. Debe omitirse o establecerse en `false` durante el despliegue.

La site key pública se configura en Webflow. Nunca debe exponerse `TURNSTILE_SECRET_KEY`.

## Límites

| Elemento | Límite |
| --- | --- |
| Cuerpo | 32 KiB |
| Estancia | 31 noches |
| Adultos | 20 |
| Niños | 20 |
| Huéspedes totales | 20 |
| Opciones | 20 |
| Cantidad por opción | 20 |
| Nombre o apellido | 100 caracteres |
| Email | 254 caracteres |
| Teléfono | 50 caracteres |
| Solicitudes especiales | 1000 caracteres |
| Token de Turnstile | 2048 caracteres |

## Errores

Las respuestas de error contienen `success: false`, un `code` estable y un mensaje seguro.

| Estado | Código |
| --- | --- |
| `400` | `INVALID_IDEMPOTENCY_KEY` |
| `400` | `INVALID_JSON` |
| `400` | `INVALID_RESERVATION_BODY` |
| `400` | `UNSUPPORTED_RESERVATION_FIELDS` |
| `400` | `INVALID_TURNSTILE_TOKEN` |
| `403` | `TURNSTILE_VERIFICATION_FAILED` |
| `404` | `BUSINESS_NOT_FOUND` |
| `404` | `SERVICE_NOT_FOUND` |
| `409` | `IDEMPOTENCY_KEY_REUSED` |
| `413` | `RESERVATION_BODY_TOO_LARGE` |
| `415` | `UNSUPPORTED_MEDIA_TYPE` |

Los errores internos no exponen información de Prisma, configuración, infraestructura ni stack traces.

## CORS y caché

La API pública responde con:

    Access-Control-Allow-Origin: *
    Cross-Origin-Resource-Policy: cross-origin
    X-Content-Type-Options: nosniff
    X-Robots-Tag: noindex, nofollow

La creación permite las cabeceras `Content-Type` e `Idempotency-Key`.

El catálogo usa caché pública breve. Disponibilidad, reservas y errores usan `no-store`. La API pública no utiliza cookies ni credenciales administrativas.

## Flujo recomendado para Webflow

1. Consultar el negocio y obtener `paymentOptions`.
2. Consultar disponibilidad.
3. Permitir elegir servicio y complementos.
4. Ejecutar Turnstile con `create_reservation`.
5. Generar un UUID para `Idempotency-Key`.
6. Enviar la reserva.
7. Conservar la clave mientras el resultado sea desconocido.
8. Mostrar `confirmationCode` al finalizar.

## Despliegue

1. Configurar las variables privadas.
2. Configurar Turnstile para los dominios reales.
3. Confirmar la acción `create_reservation`.
4. Ejecutar `npx prisma migrate deploy`.
5. Ejecutar `npm run build`.
6. Probar los endpoints desde el dominio externo.
7. Confirmar que `TURNSTILE_TEST_MODE` no esté activo.
