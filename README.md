# Conway's Game of Life

## Rendimiento del motor

El motor divide el tablero en regiones de 64 × 64 células. Sin mutación y sin
nacimientos con cero vecinos (B0), calcula solo las regiones ocupadas y sus
vecinas, respetando los bordes toroidales. Si al menos la mitad de las regiones
está activa, conserva el recorrido continuo con sumas deslizantes; B0 y mutación
también usan ese recorrido completo.

Para detectar incluso ediciones directas del array público, se busca ocupación
cada generación y se limpia el buffer destino antes del cálculo disperso. Se
mantienen los dos buffers del tablero; las listas de regiones añaden unos 118 KB
para 12000 × 8000. El beneficio es mayor con patrones pequeños en tableros grandes.

Comparación con el motor anterior: `npm run bench -- --tiles`. Agregar
`--sparse --large --no-mutation` mide un glider en el tablero de 12000 × 8000.

## Configuración y navegación

- **Intervalo (ms)** define el tiempo entre generaciones, entre 1 y 60.000 ms.
  **Aplicar configuración** actualiza el intervalo incluso durante la reproducción.
  El tiempo real también depende de lo que tarde en calcularse cada generación.
- **Columnas** y **Filas** cambian el tamaño en células. Redimensionar pausa el
  juego, reinicia el contador y conserva la intersección centrada del patrón.
  Al reducir el tablero se recortan los bordes. Se admiten hasta 12.000 células
  por lado y 96 millones en total.
- **Dibujar** permite pintar o borrar. **Mover** permite arrastrar la vista;
  también funciona Mayús + arrastrar o arrastrar con el botón central o derecho.
- La rueda y los botones **+ / −** cambian el zoom del tablero. **Ver todo**
  encaja el tablero y **Centrar · 100%** vuelve al centro con 5 píxeles por célula.
  Las flechas de la barra desplazan la vista. Con el tablero enfocado, también
  funcionan las teclas de flecha, **+ / −** y **0** para ver todo.
- Los canvas tienen el tamaño de la vista y solo se dibuja la región visible;
  el resto del tablero sigue participando en la simulación.

## Editar reglas

**Editar reglas** pausa el juego y abre un modal con dos columnas: **Sobrevive**
(célula viva que sigue viva) y **Revive** (célula muerta que pasa a estar viva).
Cada columna muestra de 0 a 8 vecinos. Una opción sin marcar significa que la
célula muere o sigue muerta, respectivamente. **Aplicar reglas** conserva el
tablero y usa la nueva regla en la siguiente generación; **Cancelar** o Escape
descarta los cambios. Los botones Conway y Seeds recuperan sus reglas
predefinidas. Las reglas personalizadas también se conservan al exportar y cargar RLE.

## Cargar y exportar patrones RLE

- **Cargar RLE (.txt)** permite seleccionar archivos `.txt` o `.rle`. La carga
  pausa la simulación, reemplaza el tablero y centra el patrón según las dimensiones
  declaradas en su cabecera. Reinicia las generaciones y desactiva la mutación.
  El patrón debe caber en el tablero. El límite por archivo es 1 MB.
- **Exportar RLE (.txt)** descarga `patron-conway.txt` o `patron-seeds.txt` con el
  estado actual, las dimensiones completas y la regla. Se conservan las posiciones
  de las células al volver a cargar el archivo.
- Se admiten comentarios `#`, repeticiones y los símbolos `b` (muerta), `o` (viva),
  `$` (salto de fila) y `!` (fin). Las reglas admitidas son Conway `B3/S23` y Seeds
  `B2/S`, además de reglas personalizadas B/S con vecinos de 0 a 8; una cabecera sin regla usa Conway. Un error de validación conserva el
  tablero existente y muestra el motivo.

Ejemplo de un glider para guardar como `glider.txt`:

```text
#N Glider
x = 3, y = 3, rule = B3/S23
bo$2bo$3o!
```

El contenido sigue el [formato RLE de ConwayLife](https://conwaylife.com/wiki/Run_Length_Encoded).

## React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
