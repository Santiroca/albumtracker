# Album Tracker — World Cup 2026

Album Tracker es una app web/PWA para llevar el control de figuritas del álbum del Mundial 2026.

Permite marcar figuritas, ver faltantes, controlar repetidas, importar listas y comparar con amigos para facilitar intercambios.

---

## Funciones

### Álbum

- Marcar figuritas como pegadas.
- Sumar copias para detectar repetidas.
- Buscar figuritas por código, país o jugador.
- Filtrar figuritas por:
  - Todas
  - Faltan
  - Tengo
  - Repetidas

---

### Progreso

- Ver el avance general del álbum.
- Ver estadísticas de figuritas pegadas, faltantes y repetidas.
- Consultar progreso por equipos/secciones.

---

### Intercambio

- Generar un código personal para compartir.
- Agregar amigos mediante código o QR.
- Ver qué repetidas de un amigo te sirven.
- Ver faltantes de un amigo.
- Comparar figuritas para organizar intercambios.

---

### Más / Configuración

Desde la sección Más se pueden encontrar opciones como:

- Compartir faltantes.
- Compartir repetidas.
- Importar/exportar colección.
- Importar listas desde Figuritas App.
- Buscar actualización.
- Borrar álbum.

---

## Importar desde Figuritas App

La app permite pegar listas generadas desde Figuritas App.

Acepta listas en español, por ejemplo:

```txt
Figuritas App - Lista
Me faltan
Repetidas
```

Y listas en inglés, por ejemplo:

```txt
Figuritas App - List
I need
Swaps
```

---

## PWA

La app puede instalarse en celular o computadora.

En iPhone:

1. Abrir la app desde Safari.
2. Tocar Compartir.
3. Elegir Agregar a pantalla de inicio.

En Android:

1. Abrir la app desde Chrome.
2. Tocar el menú.
3. Elegir Instalar app o Agregar a pantalla de inicio.

---

## Tecnologías

- HTML
- CSS
- JavaScript
- Supabase
- GitHub Pages
- PWA / Service Worker
- QRCode.js
- jsQR
- Google Analytics 4

---

## Estructura

```txt
index.html
app.js
data.js
style.css
manifest.json
sw.js
images/
README.md
```

---

## Deploy

La app está pensada para funcionar como sitio estático.

Para GitHub Pages, los archivos principales deben estar en la raíz del repositorio:

```txt
index.html
app.js
data.js
style.css
manifest.json
sw.js
images/
```

---

## Notas

- No usa backend Node.
- No usa `server.js`.
- No usa `package.json`.
- No requiere login obligatorio.
- La colección se guarda principalmente en el navegador del usuario.
- Las funciones online usan Supabase.
