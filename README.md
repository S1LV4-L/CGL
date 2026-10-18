# Conway's Game of Life

## Cargar y exportar patrones RLE

- **Cargar RLE (.txt)** permite seleccionar archivos `.txt` o `.rle`. La carga
  pausa la simulación, reemplaza el tablero desde la esquina superior izquierda,
  reinicia las generaciones y desactiva la mutación. El patrón debe caber en las
  100 × 100 células del tablero. El límite por archivo es 1 MB.
- **Exportar RLE (.txt)** descarga `patron-conway.txt` o `patron-seeds.txt` con el
  estado actual, las dimensiones completas y la regla. Se conservan las posiciones
  de las células al volver a cargar el archivo.
- Se admiten comentarios `#`, repeticiones y los símbolos `b` (muerta), `o` (viva),
  `$` (salto de fila) y `!` (fin). Las reglas admitidas son Conway `B3/S23` y Seeds
  `B2/S`; una cabecera sin regla usa Conway. Un error de validación conserva el
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
