import { useToast } from './use-toast';

interface ToastCallbackOptions {
  successTitle?: string;
  successDescription?: string;
  errorTitle?: string;
}

/**
 * A reusable hook that provides consistent success/error callbacks for mutations
 * Usage:
 * const callbacks = useToastCallbacks({
 *   successTitle: 'Success',
 *   successDescription: 'Operation completed',
 *   errorTitle: 'Error'
 * });
 * 
 * mutation.mutate(data, callbacks);
 */
export function useToastCallbacks(options: ToastCallbackOptions) {
  const { toast } = useToast();

  return {
    onSuccess: () => {
      toast({
        title: options.successTitle || 'Success',
        description: options.successDescription,
      });
    },
    onError: (error: any) => {
      toast({
        title: options.errorTitle || 'Error',
        description: error?.message || 'An unexpected error occurred',
        variant: 'destructive',
      });
    },
  };
}
