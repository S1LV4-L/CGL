interface ContadorProps {
  valor: number;
}

export function GenerationCounter({ valor }: ContadorProps) {
  return (
    <div>
      <h2>Generaciones: {valor}</h2>
    </div>
  );
};
