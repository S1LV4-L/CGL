/// <reference types="vite/client" />

export type Pattern = {
    id: string;          // nombre del archivo sin extensión
    name: string;        // de #N, o fallback al id
    description: string; // de #C, concatenado si hay varias líneas
    rle: string;        // contenido completo del .txt
    width: number;
    height: number;
};

// Carga todos los .txt de src/patterns/ en build time (sin fetch ni manifest).
// Vite 5+: query + import. En Vite 4 usar: { as: "raw", eager: true }
const modules = import.meta.glob("../patterns/*.txt", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

function parsePatternMeta(content: string, id: string): Pattern {
    let name = id;
    let description = "";
    for (const line of content.split(/\r\n|\n/)) {
        const n = /^#N\s+(.+)$/i.exec(line);
        if (n) name = n[1].trim();
        const c = /^#C\s+(.+)$/i.exec(line);
        if (c) description += (description ? " " : "") + c[1].trim();
    }
    const header = /x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/i.exec(content);
    return {
        id,
        name,
        description,
        rle: content,
        width: header ? Number(header[1]) : 0,
        height: header ? Number(header[2]) : 0,
    };
}

export const PATTERNS: Pattern[] = Object.entries(modules)
    .map(([path, content]) =>
        parsePatternMeta(content, path.split("/").pop()!.replace(/\.txt$/i, "")),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es"));