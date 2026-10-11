import { useEffect, useState } from "react";
import "../styles/BotonTema.css";

// Tipo de dato personalizado para restringir los valores permitidos del tema a 2 valores exactos
type Theme = "light" | "dark";

// Funcón para alternar el tema visual de la aplicación
export function ThemeToggle() {
    // Estado del tema. Se inicializa leyendo el localStorag, y si está vacío detecta la preferencia del sistema operativo
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem("theme") as Theme | null;
        if (saved) return saved;
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    });

    // Efecto secundario para aplicar el tema en el DOM y guardarlo en localStorage
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("theme", theme);
    }, [theme]); // Se ejecuta cada vez que 'theme' cambia

    // Función que intercambia entre 'light' y 'dark'
    const toggleTheme = () => {
        setTheme((prev) => (prev === "light" ? "dark" : "light"));
    };

    // Botón renderizado
    return (
        <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Cambiar tema" // Etiqueta descriptiva para lectores de pantalla
            aria-pressed={theme === "dark"} // Indica si el botón está en estado "activado"
        />
    );
}