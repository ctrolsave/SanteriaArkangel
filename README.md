# Santería Arkangel — instalación en Hostinger

## 1. Crear la base de datos

1. Entrá a **hPanel** de Hostinger → **Bases de datos** → **Bases de datos MySQL**.
2. Creá una nueva base de datos y un usuario, y anotá: nombre de la base, usuario y contraseña.
3. Abrí **phpMyAdmin** desde el mismo panel, seleccioná tu base de datos y andá a la pestaña **Importar**.
4. Subí el archivo `database.sql` (está en esta carpeta) y ejecutá la importación. Esto crea todas las tablas y carga el usuario administrador de ejemplo.

## 2. Configurar la conexión

Abrí el archivo `api/config.php` (podés editarlo desde el Administrador de archivos de Hostinger o por FTP) y completá estas 4 líneas con los datos reales de tu base:

```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'tu_base_de_datos');
define('DB_USER', 'tu_usuario');
define('DB_PASS', 'tu_contraseña');
```

## 3. Subir los archivos

1. Andá a **Administrador de archivos** en hPanel, entrá a la carpeta `public_html` (o la carpeta de tu dominio).
2. Subí **todo el contenido** de esta carpeta (no la carpeta en sí, sino lo que está adentro: `index.html`, `api/`, `assets/`, `uploads/`, etc.) directamente dentro de `public_html`.
3. Si subiste un .zip, usá la opción "Extraer" del Administrador de archivos.

## 4. Permisos de la carpeta de fotos

La carpeta `uploads/` (y sus subcarpetas `products`, `options`, `brand`) necesita permiso de escritura para que el panel de administrador pueda guardar las fotos. Desde el Administrador de archivos, click derecho sobre `uploads` → **Permisos** → poné **755** (si con eso no alcanza, probá **775**).

## 5. Entrar como administrador

Abrí tu sitio (`https://tudominio.com`) y hacé clic en **Administrar**, arriba a la derecha.

- **Usuario:** `muzaber`
- **Contraseña:** `2111`

Te recomendamos cambiar la contraseña ni bien entres, desde Administrar → Configuración.

## 6. Cargar tus productos y tus datos

Desde el panel de administrador podés:

- Cargar tu logo real (o reemplazar el que ya viene puesto) y la foto de cielo de fondo.
- Escribir el texto de "Nosotros".
- Subir tu catálogo en PDF.
- Cargar tus datos de cobro (CBU, alias, titular, link de Mercado Pago) y tu WhatsApp.
- Cargar cada uno de tus productos, con sus fotos, variantes (color/aroma/tamaño) y precios por cantidad.

## Avisos de pedidos nuevos (email y WhatsApp)

Desde Administrar → Configuración podés cargar:

- **Tu email**: apenas entra un pedido, el servidor te manda un mail automático con el resumen. Usa el correo de tu propio hosting — si al principio te llega a la carpeta de Spam, marcalo como "no es spam" para que a partir de ahí llegue bien.
- **Tu WhatsApp + clave de CallMeBot**: para el aviso automático por WhatsApp usamos [CallMeBot](https://www.callmebot.com/), un servicio **gratuito pero no oficial** (no es de Meta/WhatsApp) pensado para uso personal. Es gratis y funciona bien, pero al ser un proyecto independiente no tiene garantía de una empresa grande atrás — puede eventualmente fallar o dejar de funcionar sin aviso. Si en algún momento necesitás algo 100% oficial y con garantía, existe la API de WhatsApp Business de Meta, pero es paga y requiere verificar tu empresa.

Para conseguir la clave de CallMeBot: agregá el contacto **+34 611 01 16 37** a tu WhatsApp, mandale el mensaje *"I allow callmebot to send me messages"*, y te va a responder con tu clave personal (puede demorar unos minutos). Esa clave es la que pegás en Configuración.

## Imprimir el ticket de un pedido

En Administrar → Pedidos, cada pedido tiene un botón **"🖨️ Imprimir ticket"** que abre una ventana lista para imprimir, con los datos del cliente (nombre, teléfono, dirección) y el detalle de los productos — pensado para pegarlo en el paquete al despachar.

## Cómo funciona por dentro (por si necesitás soporte técnico más adelante)


- **Base de datos:** MySQL (tablas: `settings`, `products`, `variant_groups`, `variant_options`, `price_tiers`, `customers`, `orders`, `order_items`, `categories`).
- **Backend:** PHP puro (sin frameworks), en la carpeta `api/`. Cada archivo es un endpoint independiente.
- **Frontend:** HTML + CSS + JavaScript simple (sin React ni build), en `index.html`, `assets/css/style.css` y `assets/js/app.js`.
- **Fotos:** se guardan como archivos reales dentro de `uploads/`, no como texto en la base de datos — así el sitio carga rápido y no tiene límite de tamaño de base de datos.
- **Cuentas de cliente:** cualquier persona se registra igual (no hay una cuenta "mayorista" separada); el precio baja automáticamente según la cantidad que cargues en cada producto.
- **Pedidos:** cuando un cliente confirma la compra, se guarda un pedido en la base de datos y también se abre un WhatsApp con el resumen para que te avisen. Vos podés ver todos los pedidos y cambiarles el estado (Pendiente, Confirmado, Enviado, Entregado, Cancelado) desde Administrar → Pedidos, y el cliente ve ese estado en Mi cuenta → Mis pedidos.
- **Pagos:** por ahora el sitio no cobra automáticamente. El cliente ve tus datos de transferencia o tu link de Mercado Pago y paga por fuera; vos confirmás el pedido a mano. Integrar un cobro 100% automático con Mercado Pago (que descuente stock y confirme solo) es un paso aparte que se puede sumar más adelante.
