# Album Tracker — Panini FIFA World Cup 2026

Una PWA simple y rápida para llevar el control de tu álbum de figuritas Panini del Mundial 2026. Está pensada principalmente para usarse desde iPhone, pero también funciona bien en PC.

## Características principales

- Registro rápido de figuritas por selección y número.
- Vista completa del álbum por grupos y países.
- Filtros por:
  - Todas
  - Faltan
  - Tengo
  - Repetidas
- Búsqueda inteligente:
  - `ARG-10`
  - `arg 10`
  - `argentina 10`
  - nombre del jugador
  - `mex repetidas`
- Sección de progreso por grupos y selecciones.
- Sección de repetidas agrupada por país.
- Intercambio con amigos mediante código fijo/QR.
- Escáner QR desde cámara o galería para guardar amigos.
- Cálculo automático de:
  - figuritas que vos podés dar;
  - figuritas que tu amigo te puede dar;
  - resultado del intercambio.
- Deshacer último cambio desde el toast.
- Importar y exportar colección.
- Importador flexible para distintos formatos.
- Preview antes de importar.
- Indicador de último cambio.
- Soporte PWA para instalar en pantalla de inicio.
- Funcionamiento offline mediante service worker.

## Estructura del proyecto

```text
.
├── index.html
├── style.css
├── app.js
├── data.js
├── manifest.json
├── sw.js
└── images/
    ├── wc-logo.png
    ├── whatsapp-logo.png
    ├── apple-touch-icon.png
    ├── favicon.ico
    ├── icon-192.png
    └── icon-512.png
```

## Archivos

### `index.html`

Contiene la estructura principal de la app:

- header mobile;
- sidebar de PC;
- secciones de Álbum, Progreso, Repetidas e Intercambio;
- tutorial;
- modales;
- toast;
- referencias a scripts, estilos, manifest e íconos.

### `style.css`

Contiene toda la estética responsive:

- diseño mobile y desktop;
- grilla de figuritas;
- sidebar;
- nav inferior;
- progreso;
- QR/intercambio;
- estados vacíos;
- toast;
- tutorial;
- scrollbar e indicador lateral.

### `app.js`

Contiene la lógica de la aplicación:

- carga y guardado en `localStorage`;
- registro de figuritas;
- filtros y búsqueda;
- deshacer cambios;
- import/export;
- preview de importación;
- progreso por países;
- repetidas;
- QR de intercambio;
- escáner QR;
- amigos;
- tutorial;
- PWA helpers.

### `data.js`

Base de datos del álbum:

- grupos;
- selecciones;
- figuritas;
- nombres;
- códigos;
- hologramas;
- total de figuritas.

### `manifest.json`

Configuración PWA:

- nombre de la app;
- íconos;
- color de tema;
- modo standalone;
- orientación.

### `sw.js`

Service worker:

- cachea archivos principales;
- permite abrir la app offline;
- actualiza cache por versión.


### `images/`

Carpeta con imágenes utilizadas por la app:

- logo del Mundial;
- logo de WhatsApp;
- íconos PWA;
- favicon;
- apple touch icon.

## Uso local

Podés abrir el proyecto con cualquier servidor estático. Por ejemplo:

```bash
python3 -m http.server 8000
```

Después abrí:

```text
http://localhost:8000
```

No conviene abrirlo directamente como archivo `file://`, porque varias funciones de PWA, cámara y service worker necesitan un origen HTTP/HTTPS.

## Instalación como PWA

### iPhone

1. Abrí la app en Safari.
2. Tocá el botón Compartir.
3. Elegí **Agregar a inicio**.
4. La app se instala como **Album Tracker**.

### Android

1. Abrí la app en Chrome.
2. Tocá el menú del navegador.
3. Elegí **Instalar app** o **Agregar a pantalla principal**.

## Guardado de datos

La colección se guarda localmente en el navegador usando `localStorage`.

Clave principal:

```text
pn26v2
```

Esto significa que:

- los datos quedan en el dispositivo;
- no hay servidor;
- no hay login;
- borrar datos del navegador puede borrar la colección;
- exportar backup es recomendable.

## Importar colección

La app acepta varios formatos.

### Formato recomendado

```json
{
  "app": "Album Tracker",
  "version": 2,
  "createdAt": "2026-05-06T22:40:24.791Z",
  "total": 994,
  "collection": {
    "ARG-10": 1,
    "MEX-13": 2
  }
}
```

### Formato simple

```json
{
  "ARG-10": 1,
  "MEX-13": 2
}
```

### Lista simple

```json
["ARG-10", "MEX-13", "MEX-13"]
```

### Objetos

```json
[
  { "id": "ARG-10", "count": 1 },
  { "id": "MEX-13", "qty": 2 }
]
```

### Texto libre

También puede detectar IDs dentro de texto:

```text
Tengo ARG-10, MEX13, FWC-3 y CC1
```

Antes de aplicar una importación, la app muestra una vista previa con:

- pegadas antes y después;
- repetidas antes y después;
- faltantes antes y después.

## Intercambio

La sección de intercambio permite compartir tu código fijo mediante QR.

El match compara:

- tus repetidas contra las faltantes de la otra persona;
- las repetidas de la otra persona contra tus faltantes.

La app no propone entregar figuritas únicas pegadas en tu álbum. Solo usa repetidas disponibles.

## Escáner QR

El escáner intenta leer el QR con cámara. Si falla, la app recomienda:

- subir el brillo de la pantalla donde está el QR;
- acercar o alejar el teléfono;
- centrar el QR;
- elegir una captura desde galería.

## Versionado de cache

Cada release cambia la versión del cache en `sw.js`:

```js
const CACHE = 'panini-v87';
```

Cuando se hacen cambios, conviene subir ese número para que el navegador tome los archivos nuevos.

## Deployment

Este proyecto puede subirse a cualquier hosting estático:

- GitHub Pages;
- Netlify;
- Vercel;
- Cloudflare Pages;
- hosting propio.

Para GitHub Pages, si se publica dentro de una subcarpeta, revisar `start_url` en `manifest.json`.

## Recomendaciones de mantenimiento

Antes de publicar una versión nueva:

1. Subir el número de cache en `sw.js`.
2. Verificar que `app.js` no tenga errores de sintaxis.
3. Probar en iPhone Safari.
4. Probar en modo PWA instalada.
5. Probar import/export.
6. Probar QR desde PC a iPhone.
7. Probar offline luego de cargar una vez.

## Notas

Esta app es un tracker personal/no oficial para coleccionistas. No está afiliada oficialmente a Panini ni a FIFA.


## Actualizaciones de la PWA

La app registra un Service Worker (`sw.js`) para poder abrir rápido y funcionar como app instalada.
Cuando subís una versión nueva a GitHub Pages, la app busca actualizaciones al abrirse y luego cada hora.

Si detecta una versión nueva, muestra un aviso: **Nueva actualización disponible**.
El usuario puede tocar **Actualizar** para recargar la última versión.

En algunos iPhone/Android, si la app ya estaba instalada en pantalla de inicio, puede hacer falta cerrarla desde multitarea y volver a abrirla.


## Amigos automáticos con Supabase

Esta versión permite que Benja te pase su código fijo una sola vez. Después, cuando Benja cambia sus repetidas en su app, tu app puede traer sus repetidas actualizadas desde Supabase.

### 1. Crear proyecto en Supabase

1. Entrá a Supabase y creá un proyecto.
2. Abrí **SQL Editor**.
3. Copiá y ejecutá el contenido de `supabase-setup.sql`.

### 2. Copiar URL y anon key

En Supabase abrí:

```text
Project Settings → API
```

Copiá:

```text
Project URL
anon public key
```

### 3. Pegarlo en `app.js`

Abrí `app.js` y buscá:

```js
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';
```

Pegá tus datos:

```js
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU_ANON_KEY';
```

### 4. Cómo se usa

Cada usuario ve en Intercambio su **código fijo**, por ejemplo:

```text
AT-ABC123DEF4
```

Benja te pasa ese código una sola vez. Vos lo guardás en **Mis amigos** con su nombre. Desde ese momento, cada vez que abras el match con Benja, la app intenta traer sus repetidas actualizadas.

También hay un botón:

```text
Actualizar repetidas de amigos
```

para forzar la actualización manualmente.

### Importante

Esto no usa OpenAI ni nada pago de IA. Sí necesita un proyecto Supabase para guardar los datos online. La `anon public key` de Supabase se puede usar en frontend siempre que la tabla tenga políticas RLS como las del archivo `supabase-setup.sql`.
