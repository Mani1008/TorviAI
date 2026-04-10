import { useCallback } from "react";
import { useToastContext } from "@/contexts/toast.context";

export function useToast() {
  const { addToast } = useToastContext();

  return {
    error: useCallback((msg: string) => addToast(msg, "error"), [addToast]),
    warning: useCallback((msg: string) => addToast(msg, "warning"), [addToast]),
    info: useCallback((msg: string) => addToast(msg, "info"), [addToast]),
  };
}
