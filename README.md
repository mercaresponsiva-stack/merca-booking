# Merca Booking

Merca Booking es una plataforma de gestión de reservas multi-negocio desarrollada con Next.js, Prisma y PostgreSQL.

El primer vertical implementado es alojamiento hotelero e incluye disponibilidad, tarifas, inventario, reservas, pagos, cancelaciones, devoluciones y administración por negocio.

## Desarrollo local

Instala las dependencias y prepara la base de datos:

    npm install
    npx prisma migrate dev
    npx prisma generate

Inicia el servidor:

    npm run dev

La aplicación estará disponible en `http://localhost:3000`.

## Comprobaciones

    npm run lint
    npx tsc --noEmit
    npm run build

## API pública

La API pública versionada permite consultar el catálogo hotelero, verificar disponibilidad y crear reservas desde sitios externos como Webflow.

Consulta la guía en [docs/public-api-v1.md](docs/public-api-v1.md).

## Producción

Aplica las migraciones con:

    npx prisma migrate deploy

Las variables privadas deben configurarse directamente en el entorno de despliegue y nunca almacenarse en Git.
