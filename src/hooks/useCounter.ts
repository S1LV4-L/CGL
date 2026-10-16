import { useCallback, useState } from 'react';

export function useCounter(initialValue: number = 0) {
  const [count, setCount] = useState<number>(initialValue);

  const incrementar = useCallback(() => {
    setCount((prev) => prev + 1);
  }, []);

  const resetear = useCallback(() => {
    setCount(initialValue);
  }, [initialValue]);

  return {
    count,
    incrementar,
    resetear,
  };
}
