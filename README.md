# Conway's Game of Life

Simulación toroidal de Conway, Seeds y reglas B/S personalizadas, preparada para
12.000 × 12.000 células (144 millones) en el navegador.

## Ejecutar

```sh
npm install
npm run dev
```

## Motor y rendimiento

**CPU** es el motor inicial y calcula 32 células simultáneamente mediante
operaciones de bits. El selector **Motor** también permite elegir **GPU (WebGPU)**
y **Automático**. Automático prueba GPU en tableros de al menos un millón de
células cuando más de la mitad de las regiones está activa; si GPU no está
disponible, continúa con CPU. Mantiene listas de regiones activas de 32 × 32
y solo despierta regiones vecinas cuando un cambio alcanza sus bordes. Cuando
predomina la actividad, recorre las filas completas y conserva los cambios
por región para volver al recorrido disperso. No hay campos de avance con HashLife.

El cálculo, el dibujo y la lectura de archivos ocurren en un **Web Worker**.
React recibe métricas aproximadamente cuatro veces por segundo durante Play.
Los cuadros se presentan hasta 30 veces por segundo, independientemente de las
simulaciones. Si dibujar resulta costoso, la cadencia de las vistas se reduce
para dedicarle aproximadamente un cuarto del tiempo disponible. La reproducción
GPU continúa calculando mientras se prepara una imagen; pausar, editar o
cambiar de motor espera su finalización para conservar el estado. Solo se transfiere una imagen de la vista y hay como máximo una
imagen pendiente. El estado completo permanece en el worker o en GPU.

Los dos estados CPU de 12.000² ocupan **36 MB (34,3 MiB)**. A esto se suman
listas y máscaras de regiones, unos 12 MB de resúmenes para el zoom, imágenes
de la vista y, al usar GPU, otros 36 MB de estados GPU. Las cifras de estado no representan la memoria total del navegador. Redimensionar y cargar
conservan temporalmente estados compactos adicionales para no perder datos
si la operación falla.

Al alejar la vista, CPU usa una pirámide de ocupación actualizada por cambios,
en lugar de recorrer 144 millones de células por cuadro. Cada bloque indica
si contiene alguna célula viva; el dibujo es una agregación visual del patrón.
Al acercarse se ven las células individuales.

La mutación conserva decisiones Bernoulli independientes con probabilidad
0,0001 por célula mediante distancias geométricas entre mutaciones. Para
12.000² se esperan 14.400 mutaciones por generación; esto puede activar gran
parte del tablero y reducir el beneficio del recorrido disperso.

Las métricas muestran generaciones/s, tiempo de cálculo, tiempo de dibujo y
regiones activas. Los tiempos de dibujo no incluyen la presentación final del navegador.

Resultados locales y condiciones de medición: [docs/rendimiento.md](docs/rendimiento.md).

## Configuración y navegación

- **Intervalo (ms)** fija la separación deseada entre generaciones: 1 a 60.000 ms.
  El tiempo efectivo depende del cálculo y el dibujo. El valor inicial de
  100 ms limita la reproducción aproximadamente a diez generaciones/s.
- **Columnas** y **Filas** admiten hasta 12.699 por lado y 160.667.748 células
  en total. Cambiar el tamaño pausa, reinicia generaciones y conserva la
  intersección centrada. Al reducir se recortan los bordes.
- **Dibujar** pinta o borra con un trazo. **Mover**, Mayús + arrastrar o los
  botones central/derecho desplazan la vista.
- La rueda y **+ / −** cambian el zoom; **Ver todo**, **Centrar · 100%** y las
  flechas permiten navegar. Todos estos controles flotan dentro del canvas,
  en su esquina inferior derecha, también en pantalla completa.
- **F** entra o sale de pantalla completa desde el tablero, los botones o la
  página. **Esc** sale. F no se activa al escribir en campos ni con diálogos
  abiertos. Con foco en el tablero funcionan flechas, + / − y 0 para ver todo.

## Reglas y patrones

**Editar reglas** pausa y permite elegir supervivencias y nacimientos con
0 a 8 vecinos. Aplicar conserva el tablero; cancelar descarta los cambios.
Conway usa B3/S23 y Seeds B2/S. La biblioteca de patrones se carga al abrirla,
y sus miniaturas se dibujan a partir de los runs RLE sin expandir el tablero.

**Cargar patrón o estado** admite `.rle`, `.txt` y `.cgl`:

- RLE se valida y lee por bloques, con un límite de 256 MiB. El patrón debe
  caber; se centra, reemplaza el tablero, reinicia generaciones y desactiva
  mutación. Se admiten comentarios #, repeticiones y b, o, $, !. Una cabecera
  sin regla usa Conway. Un error conserva el estado anterior.
- **Exportar RLE** conserva dimensiones y regla. En navegadores con selector
  de guardado, escribe bloques directamente al archivo con contrapresión,
  evitando formar una cadena gigante. En otros navegadores descarga un Blob
  formado por bloques. Un RLE mayor de 256 MiB se rechaza: usá el formato compacto.
- **Guardar estado compacto** genera `.cgl` con un bit por célula, dimensiones,
  reglas y generación. El estado de 12.000² ocupa 18.000.048 bytes. Al cargarlo
  se recuperan también tamaño y generación; la mutación queda desactivada.

## Validación y benchmarks

```sh
npm test
npm run lint
npm run build
npm run test:browser
npm run bench:large -- --large
npm run bench:gpu
```

Las pruebas de navegador usan Edge instalado en Windows; en otros sistemas
requieren Chromium de Playwright. Verifican el tablero CPU de 12.000², F/Esc,
los controles flotantes en escritorio y móvil, y el guardado y carga de archivos.
Los módulos y benchmarks de GPU y HashLife se conservan para comparaciones.
HashLife no se usa en la aplicación. La prueba de
ese módulo GPU se omite si no hay adaptador disponible.
Los benchmarks de CPU comparan el motor por bytes de referencia con el motor
empaquetado y verifican estados completos. Los resultados dependen del patrón,
equipo y navegador; no son una garantía de FPS.

El motor por bytes de `life.ts` se conserva como referencia y para benchmarks
históricos (`npm run bench`); la aplicación usa `PackedLife`. Si se modifica
su array público directamente, se debe llamar `invalidate()`. Los buffers
retirados no deben modificarse.
