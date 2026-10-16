# Registro de cambios

## 2026-10-16 — Tablero independiente del estado de React

### Objetivo

Evitar que cada generación o edición del tablero vuelva a renderizar `App`.
React mantiene el estado de los controles; el tablero se guarda en una referencia
mutable y el canvas se actualiza explícitamente.

### Cambios en `src/App.tsx`

1. Se reemplazó `boardState` y `setBoardState` por `boardRef`. Los estados
   `isPlaying`, `mode` y `allowMutation` siguen controlando la interfaz.
2. Se eliminó la creación de `initialBoard` durante cada render. Un efecto de
   montaje crea el tablero y realiza el primer dibujo. En desarrollo, StrictMode
   puede repetir este efecto como parte de sus comprobaciones de montaje.
3. Se extrajo el dibujo a `renderBoard`, una función estable que lee el tablero
   actual desde la referencia. Sustituye al efecto que dependía de `boardState`.
   Se conserva el dibujo con `fillRect` y `strokeRect`.
4. `computeNextBoard` lee `currentBoard`, calcula `nextBoard`, publica la nueva
   referencia y dibuja el resultado. Se conserva la copia por generación para
   calcular todos los vecinos a partir del mismo estado anterior.
5. `resetBoard` reemplaza el tablero y lo dibuja inmediatamente. Como antes,
   resetear no detiene la reproducción.
6. Los eventos del ratón editan directamente la celda en memoria y llaman a
   `renderBoard`. Ya no copian el tablero completo para editar una celda.
   Arrastrar sobre una celda que ya tiene el valor deseado no vuelve a dibujar.
7. Se agregaron comentarios sobre la referencia, el dibujo explícito y la
   necesidad de conservar la generación anterior durante el cálculo. Se usan
   los nombres `currentBoard` y `nextBoard` para distinguir ambas generaciones.

### Flujo resultante

- Montaje: crear tablero → guardar referencia → dibujar.
- Siguiente o intervalo: leer tablero → calcular generación → guardar → dibujar.
- Edición: modificar celda → dibujar.
- Reset: crear tablero vacío → guardar → dibujar.
- Controles: actualizar el estado de React; el tablero existente se conserva.

### Alcance y límites

Se mantienen las dimensiones presentes al iniciar este cambio (3620 × 1580
píxeles, con células de 10 píxeles), las reglas Conway/Seeds, los bordes
toroidales, la mutación y el intervalo de 100 ms.

Este cambio evita renders de React por operaciones del tablero y copias al
editar células. El cálculo y el dibujo siguen ejecutándose en el hilo principal,
y cada actualización visual sigue repintando todo el canvas. Todavía no se
incorporan workers, buffers tipados ni una frecuencia de dibujo independiente.

### Validación

- `npm run lint`.
- `npm run build`.
- Comprobación funcional en Node con hooks y canvas simulados: edición, borrado,
  reset, oscilador Conway, vecinos toroidales, Seeds, conservación del tablero
  al cambiar controles e inicio/limpieza del intervalo. También se verifica que
  avanzar, editar y resetear no invoquen setters de estado de React.

La comprobación funcional no sustituye una prueba visual en navegador ni mide
la mejora de rendimiento.

## 2026-10-16 — Renderizado por imagen y edición parcial

### Problema

El tablero contiene 362 × 158 = 57.196 células. El dibujo anterior ejecutaba
114.392 llamadas a `fillRect`/`strokeRect` por actualización, incluso al editar
una sola célula. Eliminar renders de React no eliminaba ese trabajo del canvas.

### Cambios por archivo

1. `src/rendering/boardRenderer.ts`: nuevo módulo dedicado al dibujo. Su API
   ofrece `renderBoard`, `renderCell` y `dispose`; solo lee el tablero y no
   calcula generaciones ni modifica células.
2. El módulo crea una sola imagen `ImageData` de 362 × 158 píxeles y un canvas
   auxiliar del mismo tamaño. En cada dibujo completo recorre el tablero para
   escribir colores RGBA, realiza un `putImageData` y amplía la imagen al canvas
   visible con un `drawImage`. Desactiva el suavizado para conservar los bordes
   cuadrados. La imagen se reutiliza; el tablero continúa siendo `number[][]`.
3. La edición usa un conjunto de índices de células pendientes. Si una célula
   recibe varios eventos antes del siguiente cuadro, solo se pinta una vez y
   con su valor más reciente. Se ejecuta un `fillRect` por célula afectada,
   sin recorrer ni borrar el resto del tablero.
4. Las solicitudes de dibujo comparten un único `requestAnimationFrame`
   pendiente. Si llegan varias generaciones antes de pintar, se muestra la más
   reciente; todas las generaciones siguen calculándose normalmente.
5. Un dibujo completo pendiente tiene prioridad sobre los dibujos parciales:
   incluye las últimas ediciones. Reset o una nueva generación descartan la
   lista de células pendientes de la imagen anterior. El canvas auxiliar solo
   se sincroniza en dibujos completos; entonces se reconstruye desde el tablero
   actual, incluyendo las células que se editaron directamente en pantalla.
6. La grilla se traza una vez por montaje en un segundo canvas transparente,
   mediante líneas compartidas entre células. Puede cambiar ligeramente la
   apariencia del borde frente al trazo anterior de un rectángulo por célula.
7. `src/App.tsx`: crea y conserva el renderer en una referencia. Avanzar y
   resetear solicitan un dibujo completo; los eventos del ratón solicitan un
   dibujo parcial. El desmontaje cancela el cuadro pendiente mediante `dispose`;
   StrictMode puede desmontar y volver a inicializar sin dejar cuadros antiguos.
8. `src/styles/estilos.css`: posiciona la grilla sobre el canvas de células.
   `pointer-events: none` permite que el ratón alcance el canvas inferior y
   `background: transparent` evita tapar las células.
9. `tests/boardRenderer.test.mjs` y `package.json`: se agregan cuatro pruebas
   ejecutables con `npm test`, sin dependencias adicionales. Requieren Node con
   soporte de ejecución de TypeScript sin compilación (verificadas en Node 24).

### Flujo de dibujo

- Editar: modificar el tablero inmediatamente → marcar célula → en el próximo
  cuadro pintar solo las células marcadas.
- Generación/reset: actualizar el tablero inmediatamente → solicitar dibujo
  completo → en el próximo cuadro actualizar la imagen y ampliarla.
- La grilla permanece en su propia capa durante ambos recorridos.

### Validación y límites

- `npm test`: cuatro pruebas con canvas y reloj simulados, incluyendo orientación
  de ejes en un tablero rectangular, agrupación de eventos, borrado, prioridad
  de reset/generación, reconstrucción tras edición y cancelación al desmontar.
- `npm run lint` y `npm run build`: correctos.
- No se pudo completar la inspección visual: el navegador integrado devolvió
  `ERR_CONNECTION_TIMED_OUT` al abrir el servidor local. Las pruebas de canvas
  simulado no verifican la composición visual real del navegador.

Se mantienen dimensiones, reglas, mutación, controles y el intervalo de 100 ms.
El cálculo sigue en el hilo principal. La imagen completa sigue recorriendo
todas las células y cubriendo todo el canvas; no se agregaron zoom, recorte a la
región visible ni workers. No se midieron FPS ni se promete un factor de mejora.

## 2026-10-16 — Tablero plano y doble buffer reutilizable

### Objetivo

Eliminar la matriz `number[][]` y la copia de todas sus filas en cada generación.
La simulación utiliza dos `Uint8Array` del mismo tamaño: un byte por célula,
con valores 0 y 1. Ambos se crean al montar el componente.

### Cambios por archivo

1. `src/simulation/life.ts`: se extrae el motor a `createSimulation(ancho, alto)`.
   Define los tipos compartidos `Board` y `GameMode` y ofrece `board`, `setCell`,
   `step` y `reset`. El índice de una célula es `y * ancho + x`, de izquierda a
   derecha y de arriba abajo.
2. `step` lee únicamente `currentBoard` y escribe todos los resultados en
   `nextBoard`, incluidos los ceros. Al terminar intercambia las referencias de
   los dos buffers. No crea arrays, no copia el tablero ni limpia el destino
   por generación. Escribir cada posición evita recuperar valores antiguos al
   reutilizar el destino.
3. `board` es una propiedad que devuelve el buffer vigente. Hay que volver a
   leerla después de cada paso; una referencia guardada antes pasa a ser el
   destino del siguiente cálculo, no una copia histórica independiente.
4. `setCell` edita el buffer vigente y devuelve si cambió la célula. `reset`
   vacía ambos buffers con `fill(0)` sin reemplazarlos. Los eventos de edición
   conservan su actualización parcial del canvas.
5. Se mantienen Conway B3/S23, Seeds B2/S0, los bordes toroidales y la inversión
   aleatoria con probabilidad 0,0001 por célula y generación. El parámetro
   opcional `random` permite probar la mutación de forma determinista; en la
   aplicación se sigue usando `Math.random`. El recorrido ahora es por filas:
   conserva la distribución de la mutación, sin prometer una misma secuencia
   espacial aleatoria que el recorrido anterior por columnas.
6. `src/App.tsx`: `simulationRef` reemplaza a `boardRef`. Avanzar delega en
   `simulation.step`, resetear en `simulation.reset`, y dibujar obtiene siempre
   `simulation.board`. Se eliminan `createBoard`, el conteo local de vecinos y
   la copia con `map`. La inicialización sigue ocurriendo al montar.
7. Se renombran `NUM_ROWS`/`NUM_COLS` como `GRID_WIDTH`/`GRID_HEIGHT`: las
   constantes anteriores nombraban filas al ancho y columnas al alto. Ahora
   la edición, la simulación y el renderer usan el mismo convenio de coordenadas.
8. `src/rendering/boardRenderer.ts`: importa el tipo común y lee el buffer plano.
   El dibujo completo recorre sus posiciones en el mismo orden que los píxeles
   RGBA. La edición parcial lee la posición plana de cada célula pendiente.
   Se conservan ImageData reutilizable, grilla estática y agrupación por cuadro.
9. `tests/boardRenderer.test.mjs`: se adaptan los casos existentes al formato
   plano y se agrega la integración con el motor real: varias generaciones
   pueden intercambiar buffers antes del mismo cuadro, y se pinta la última.
10. `tests/life.test.mjs`: se agregan casos de Conway, Seeds, ambos bordes,
    edición/borrado tras intercambiar buffers, reutilización de las mismas dos
    referencias, sobrescritura de datos antiguos, reset y mutación. Se compara
    el motor contra una referencia de matrices durante 60 generaciones por
    tamaño, con cambios de regla y tableros rectangulares y pequeños.

### Memoria y flujo

Con el tamaño actual de 362 × 158 células, los dos buffers ocupan exactamente
114.392 bytes de datos (aproximadamente 111,7 KiB), además de los objetos que
los contienen. Este valor no incluye ImageData, canvases ni memoria de React.

- Paso: leer A → escribir B completo → intercambiar A/B → solicitar dibujo.
- Paso siguiente: leer B → escribir A completo → intercambiar B/A.
- Edición: obtener el buffer vigente → modificar célula → solicitar dibujo parcial.
- Reset: vaciar ambos buffers → solicitar dibujo completo.

### Validación y alcance

- `npm test`: 13 pruebas correctas (motor, renderer e integración entre ambos).
- `npm run lint` y `npm run build`: correctos.
- No se midieron FPS ni tiempos por generación en el navegador.

Se preservan las dimensiones y el intervalo de **5 ms** que estaban presentes
al comenzar este cambio. El cálculo continúa en el hilo principal y recorre
todas las células. Se mantiene el conteo con operaciones módulo para conservar
los bordes; optimizarlo corresponde al punto 4 y no forma parte de este cambio.

## 2026-10-16 — Conteo directo de vecinos y selección de reglas

### Objetivo

Eliminar los bucles de desplazamientos y las operaciones módulo por vecino del
recorrido principal, conservando las reglas y la envoltura toroidal.

### Cambios por archivo

1. `src/simulation/life.ts`: se incorpora un buffer auxiliar `halo` de
   `(ancho + 2) × (alto + 2)` bytes, reservado una sola vez. Los dos tableros
   públicos conservan su formato y siguen alternándose sin asignaciones por paso.
2. Antes de calcular, `refreshHalo` copia el tablero actual al interior del
   auxiliar. Cada fila copia su extremo derecho a la izquierda y viceversa.
   Después se copian la última fila arriba y la primera abajo, incluidas las
   esquinas. Esto también respeta la multiplicidad de vecinos del motor anterior
   en tableros de una o dos células de ancho/alto.
3. El recorrido principal suma ocho posiciones conocidas alrededor de cada
   célula. Ya no necesita bucles de vecinos, condiciones de borde ni `%`.
   Los desplazamientos de fila usan `stride = ancho + 2`.
4. Conway y Seeds usan tablas de 18 entradas: `estadoActual * 9 + vecinos`.
   Las tablas se construyen una vez por módulo y se seleccionan una vez por
   generación. Se evita comprobar el modo para cada célula.
5. La mutación se aplica en un recorrido separado únicamente cuando está
   activada. Conserva el mismo orden de llamadas a `random` por filas y el
   umbral 0,0001. No añade decisiones sobre mutación al conteo principal.
6. `reset` limpia también el auxiliar. Como antes, el paso escribe todas las
   posiciones del destino, incluidos los ceros, antes de intercambiar buffers.
7. `tests/life.test.mjs`: se extiende la comparación contra la referencia a
   tableros de una fila, una columna y 2 × 2. Se prueban las 512 configuraciones
   posibles de una región 3 × 3 en cada regla y las ediciones de las cuatro
   esquinas antes de calcular y después de resetear.
8. `benchmarks/life-before-point4.ts`: copia congelada del motor previo para
   comparación; la aplicación no la importa. `benchmarks/life.mjs` mide ambos
   motores sobre los mismos estados y verifica igualdad completa de resultados,
   incluso con mutación y un generador aleatorio de semilla fija.
9. `package.json`: se agrega `npm run bench`. La medición alterna el orden de
   ejecución, realiza 10 pasos de calentamiento y presenta la mediana de cinco
   muestras. Cada muestra mide 30 pasos en el tablero actual y ocho en 1024².

### Costo de memoria y copias

El auxiliar agrega 58.240 bytes (56,9 KiB) para 362 × 158 células. Junto con los
dos buffers de estado, el almacenamiento de datos por simulación pasa de
114.392 a 172.632 bytes (168,6 KiB), sin contar objetos, tablas de reglas ni canvas.

A diferencia del paso previo, ahora hay una copia del tablero al auxiliar en
cada generación. Es memoria reutilizada: no se crean arrays ni vistas por paso.
Esta copia permite reemplazar las comprobaciones repetidas de vecinos por
lecturas directas; su costo está incluido en el benchmark.

### Resultados observados

Node v24.19.0, Windows x64. Tiempos medianos en milisegundos por generación,
solo motor, sin canvas ni interfaz. La mutación del benchmark utiliza azar
reproducible; sus tiempos no representan exactamente el costo de `Math.random`.

| Células | Regla | Mutación | Antes | Después | Aceleración |
| --- | --- | --- | ---: | ---: | ---: |
| 362 × 158 | Conway | OFF | 2,231 | 0,325 | 6,86× |
| 362 × 158 | Seeds | OFF | 2,239 | 0,330 | 6,79× |
| 362 × 158 | Conway | ON | 3,550 | 1,052 | 3,37× |
| 1024 × 1024 | Conway | OFF | 34,522 | 6,090 | 5,67× |
| 1024 × 1024 | Seeds | OFF | 34,855 | 6,089 | 5,72× |
| 1024 × 1024 | Conway | ON | 46,072 | 19,296 | 2,39× |

Los valores dependen del equipo, del motor JavaScript y de los patrones. Son
una ejecución comparativa local, no una garantía de FPS ni de rendimiento en
otros tamaños o navegadores.

### Validación y alcance

- `npm test`: 15 pruebas correctas, incluyendo renderer e integración.
- `npm run lint` y `npm run build`: correctos.
- `npm run bench`: ambos motores producen los mismos estados finales en todos
  los casos medidos.

No se modifican App, el renderer, las dimensiones ni el intervalo actual de
5 ms. El cálculo continúa en el hilo principal y sigue recorriendo todo el
tablero; este cambio reduce el costo por célula, no su complejidad O(ancho × alto).
