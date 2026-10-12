import { useEffect, useRef } from "react";
import Stats from "stats.js";

export default function FpsViewer() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Crear la instancia de Stats
    const stats = new Stats();

    // 0: FPS, 1: MS (milisegundos por frame), 2: MB (memoria asignada)
    stats.showPanel(0);

    // 2. Estilizar el contenedor para que flote en la pantalla
    const domElement: HTMLDivElement = stats.dom;
    domElement.style.position = "fixed";
    domElement.style.top = "10px";
    domElement.style.left = "10px";
    domElement.style.zIndex = "9999";

    // 3. Agregar el visor al contenedor del DOM de React
    container.appendChild(domElement);

    // 4. Bucle de animación para actualizar los FPS en cada frame
    let animationFrameId: number;
    const updateStats = (): void => {
      stats.begin();
      // Aquí se mide el rendimiento del renderizado de la app
      stats.end();
      animationFrameId = requestAnimationFrame(updateStats);
    };

    animationFrameId = requestAnimationFrame(updateStats);

    // 5. Limpieza al desmontar el componente
    return () => {
      cancelAnimationFrame(animationFrameId);
      if (domElement.parentNode === container) {
        container.removeChild(domElement);
      }
    };
  }, []);

  return <div ref={containerRef} />;
}