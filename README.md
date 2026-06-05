# Juspit B2B Quote App

App Shopify con **App Proxy** para crear **Draft Orders** de cotización cuando un cliente B2B pulsa "Solicitar Cotización" en el carrito.

## Arquitectura

- **Tema** (`juspit-copia-1`): snippet `b2b-quote-button.liquid` + `assets/b2b-quote.js`
- **App** (este repo): Express + Admin GraphQL `draftOrderCreate`
- **Shopify Flow**: trigger manual en Admin (draft order created + tag `quote-request`)

## Requisitos

- Node.js 18+
- Cuenta [Shopify Partners](https://partners.shopify.com)
- Tienda con **Shopify B2B** habilitado
- Hosting HTTPS (Fly.io, Railway, Render, etc.)

## Variables de entorno

Copia `.env.example` a `.env`:

| Variable | Descripción |
|----------|-------------|
| `SHOPIFY_API_KEY` | Client ID de la app |
| `SHOPIFY_API_SECRET` | Client secret (validación HMAC App Proxy) |
| `SCOPES` | `write_draft_orders,read_customers,read_products` |
| `HOST` | URL pública HTTPS, ej. `https://tu-app.fly.dev` |
| `PORT` | Puerto local (default `3000`) |
| `SHOPIFY_SHOP` | (Opcional) Dominio myshopify para `GET /health` → `sessionInstalled` |
| `DATABASE_URL` | URL de PostgreSQL (Render: Internal Database URL) |

Las sesiones offline se persisten en **PostgreSQL** (`shopify_sessions`). Tras el primer deploy con esta configuración, reinstala OAuth una vez (`/auth?shop=...`).

## Instalación local

```bash
cd juspit-b2b-quote-app
npm install
npm run dev
```

## Configurar la app en Partners

1. Crea la app en Partners Dashboard.
2. Actualiza `shopify.app.toml`:
   - `client_id`
   - `application_url` = tu `HOST`
   - `[app_proxy].url` = `{HOST}/api/proxy`
3. Scopes: `write_draft_orders`, `read_draft_orders`, `read_customers`, `read_products`.
4. Redirect URL: `{HOST}/auth/callback`.

## Interfaz en Shopify Admin

La app está **embebida** (`embedded = true`). Al abrirla en Admin verás:

- Estado de conexión (sesión offline)
- Últimas cotizaciones (draft orders con tags `quote-request`, `solicitud-cotización`, `b2b-request`)
- Enlace a cada borrador en Admin

Requiere scope `read_draft_orders`. Tras cambiar scopes, reinstala la app.

## Instalar en la tienda

Visita (sustituye valores):

```
https://TU_HOST/auth?shop=tu-tienda.myshopify.com
```

Tras OAuth, la sesión offline se guarda en PostgreSQL.

## App Proxy

| Campo | Valor |
|-------|--------|
| Prefix | `apps` |
| Subpath | `create-b2b-draft-order` |
| Proxy URL | `https://TU_HOST/api/proxy` |

URL en storefront: `POST https://{shop}/apps/create-b2b-draft-order`

Shopify añade query params: `shop`, `logged_in_customer_id`, `signature`, `timestamp`, etc.

## Integración tema

1. Sube el tema con los archivos:
   - `snippets/b2b-quote-button.liquid`
   - `assets/b2b-quote.js`
   - `sections/main-cart-footer.liquid` (incluye el snippet)
2. El tema muestra un modal de confirmación tras el éxito (no requiere página de éxito; `page.quote-request-success` es opcional/legacy).

## Shopify Flow (manual)

1. **Trigger:** Draft order created  
2. **Condition:** Tags contains `quote-request` and/or `solicitud-cotización` (draft orders are also tagged `b2b-request`)  
3. **Action:** Send internal email  

Cuerpo sugerido:

- Cliente: `{{ draftOrder.customer.displayName }}`
- Email / teléfono del customer
- Nota del draft
- Atributos personalizados (`company_name`, `shipping_address`)
- Líneas de producto
- Enlace admin al draft order

## API — respuesta exitosa

```json
{
  "success": true,
  "draft_order_id": "gid://shopify/DraftOrder/123",
  "invoice_url": "https://..."
}
```

## Errores

| HTTP | `error` |
|------|---------|
| 401 | `invalid_signature`, `customer_not_authenticated` |
| 400 | `empty_cart`, `invalid_cart` |
| 502 | `draft_order_failed` |
| 503 | `app_not_installed` |

## Tests

```bash
npm test
```

## Despliegue

```bash
npm run build
npm start
```

En producción usa `shopify app deploy` si gestionas la app con Shopify CLI.

## Convivencia con WCP/WPD

Este flujo **no** usa el checkout ni `/apps/wpdapp`. Los precios del draft se toman del carrito (`final_line_price / quantity` en el JS).

## Seguridad

- Firma HMAC en cada petición App Proxy
- `logged_in_customer_id` obligatorio
- Sin tokens Admin en el tema
