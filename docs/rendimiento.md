# Rendimiento y validación — 2026-10-28

**Configuración actual:** CPU es el motor inicial; el selector permite elegir
también GPU o Automático. HashLife se conserva como módulo experimental sin
controles en la interfaz.

Implementación para tableros de hasta 12.000 × 12.000, comprobada con
144 millones de células. Los resultados son locales y dependen del equipo,
el patrón, la regla, el navegador y la mutación.

## CPU

Node v24.19.0, Windows x64, AMD Ryzen 5 4500. Conway, sin mutación.
Mediana de tres muestras; cada muestra mide la primera generación por separado,
calienta hasta la cuarta y promedia de la quinta a la novena. La preparación
del patrón, la reserva de memoria y el dibujo están fuera del tiempo de cálculo.
El benchmark verifica todos los estados finales entre ambos motores.

| Caso en 12.000² | Motor por bytes de referencia | CPU empaquetada |
| --- | ---: | ---: |
| Glider, primera generación | 671,018 ms | 0,234 ms |
| Glider, generaciones 5–9 | 0,629 ms/generación | 0,011 ms/generación |
| Inicial aleatorio al 35 %, primera generación | 732,785 ms | 232,165 ms |
| Inicial aleatorio al 35 %, generaciones 5–9 | 714,569 ms/generación | 231,403 ms/generación |
| Dos estados completos | 288 MB | 36 MB |

La reducción de memoria del estado es de 8×. En esta corrida, las generaciones
medidas del caso inicialmente denso mejoran 3,09× y las del glider aproximadamente
60×. El porcentaje vivo cambia durante la evolución del patrón aleatorio.

Un avance HashLife de 1.024 generaciones para un glider tardó 44,4 ms,
incluyendo preparación del árbol y conversión de vuelta al estado empaquetado.
La primera rasterización de su vista general de 1.024 × 768 tardó 112,2 ms,
incluyendo la construcción inicial de los resúmenes. Son mediciones individuales,
no medianas, y no representan el costo de los cuadros posteriores con caché.

Reproducir: `npm run bench:large -- --large`.
Datos sin redondear: [large-results.json](../benchmarks/large-results.json).

## GPU

Edge 156 sin opciones especiales de GPU, adaptador informado como NVIDIA Ampere.
Conway, sin mutación, mismo patrón inicial aleatorio al 35 % y tamaño 12.000².
Tres muestras; generaciones 5–9. Se espera la finalización real de los comandos
GPU, sin descargar el tablero a CPU entre generaciones.

| Medición | Mediana |
| --- | ---: |
| Primera generación, excluyendo creación de pipelines y subida inicial | 16,00 ms |
| Generaciones 5–9, solo cálculo y sincronización de cola | 3,74 ms/generación |
| Dibujo de vista general, 1.024 × 768 | 5,50 ms/cuadro |

El tiempo de cálculo corresponde aproximadamente a 267 generaciones/s del
motor en estas condiciones; la reproducción completa también incluye dibujo,
programación del worker y presentación. El intervalo inicial de 100 ms limita
la reproducción aproximadamente a diez generaciones/s. La comparación entre
Node y Edge no es un benchmark aislado del procesador frente a la GPU.

Cada buffer empaquetado ocupa 18 MB. Se mantienen los dos buffers GPU y los
dos estados CPU para sincronizar edición, exportación y cambios de motor.
No se descarga el tablero completo en cada cuadro.

Reproducir: `npm run bench:gpu` (Edge instalado en Windows; Chromium de
Playwright en otros sistemas). Datos: [gpu-results.json](../benchmarks/gpu-results.json).

## Verificación

- Pruebas de CPU contra una referencia independiente por célula: reglas B/S,
  B0, Conway y Seeds; toro estrecho, palabras parciales, cambios de regla,
  regiones que se duermen y ediciones en la última región de una sola célula.
- HashLife contra generaciones CPU individuales en toros rectangulares,
  incluyendo reglas personalizadas y B0. Límite de caché sin modificar el estado.
- Importación y redimensionado por palabras, RLE por bloques y checkpoints
  binarios; validación de reglas, generaciones y bits de relleno.
- Resúmenes de zoom: conservación de células aisladas y eliminación de datos
  viejos después de pasos, ediciones y reset.
- Edge real: simulación de 12.000², navegación, avances HashLife y archivo
  compacto de 18.000.048 bytes. Shaders GPU comparados palabra por palabra
  contra CPU en 15 combinaciones de tamaño y regla, incluida 12.000².
- Importación inválida que conserva el estado, RLE con contrapresión y cierre
  de archivo confirmado, y sincronización entre GPU y CPU.

Comandos: `npm test`, `npm run test:browser`, `npm run lint`, `npm run build`.
El navegador omite únicamente la comparación GPU si no hay adaptador disponible.
Los benchmarks históricos por bytes permanecen disponibles con `npm run bench`.
