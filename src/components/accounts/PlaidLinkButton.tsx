'use client';

import * as React from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Loader2, Building2 } from 'lucide-react';

interface PlaidLinkButtonProps extends ButtonProps {
  onSuccess?: () => void;
  onExit?: () => void;
}

export const PlaidLinkButton = React.forwardRef<
  HTMLButtonElement,
  PlaidLinkButtonProps
>(
  (
    {
      onSuccess,
      onExit,
      onClick,
      variant = 'default',
      size = 'default',
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const [linkToken, setLinkToken] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [shouldOpen, setShouldOpen] = React.useState(false);
    const prefetchStarted = React.useRef(false);

    // Fetch link token when button is clicked
    const fetchLinkToken = React.useCallback(async () => {
      try {
        const response = await fetch('/api/plaid/create-link-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error('Failed to create link token');
        }

        const data = await response.json();
        if (!data?.linkToken) {
          throw new Error('Missing link token from server');
        }
        setLinkToken(data.linkToken);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
        return false;
      }
    }, []);

    // Handle successful link
    const handleSuccess = React.useCallback(
      async (publicToken: string, metadata: any) => {
        setIsLoading(true);

        try {
          const response = await fetch('/api/plaid/exchange-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicToken, metadata }),
          });

          if (!response.ok) {
            throw new Error('Failed to link account');
          }

          onSuccess?.();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to link account');
        } finally {
          setIsLoading(false);
          setLinkToken(null);
          setShouldOpen(false);
        }
      },
      [onSuccess]
    );

    // Handle exit
    const handleExit = React.useCallback((exitError?: any) => {
      if (exitError) {
        const message =
          exitError.display_message ||
          exitError.error_message ||
          exitError.message ||
          'Plaid Link exited';
        setError(message);
      }
      setLinkToken(null);
      setIsLoading(false);
      setShouldOpen(false);
      onExit?.();
    }, [onExit]);

    // Plaid Link hook
    const { open, ready, error: plaidError } = usePlaidLink({
      token: linkToken,
      onSuccess: handleSuccess,
      onExit: handleExit,
    });

    React.useEffect(() => {
      if (!shouldOpen || !linkToken || !ready) {
        return;
      }
      open();
      setShouldOpen(false);
    }, [shouldOpen, linkToken, ready, open]);

    React.useEffect(() => {
      if (!plaidError) {
        return;
      }
      const message =
        (plaidError as any)?.display_message ||
        (plaidError as any)?.error_message ||
        (plaidError as any)?.message ||
        'Failed to initialize Plaid Link';
      setError(message);
      setIsLoading(false);
      setLinkToken(null);
      setShouldOpen(false);
    }, [plaidError]);

    React.useEffect(() => {
      if (prefetchStarted.current || linkToken) {
        return;
      }
      prefetchStarted.current = true;
      fetchLinkToken();
    }, [fetchLinkToken, linkToken]);

    const handleClick = async (
      event: React.MouseEvent<HTMLButtonElement>
    ) => {
      onClick?.(event);
      if (event.defaultPrevented) {
        return;
      }
      if (isLoading) {
        return;
      }
      setIsLoading(true);
      setError(null);
      const hasToken = linkToken ? true : await fetchLinkToken();
      if (!hasToken) {
        setIsLoading(false);
        return;
      }
      if (ready) {
        setShouldOpen(false);
        open();
      } else {
        setShouldOpen(true);
      }
    };

    return (
      <>
        <Button
          ref={ref}
          variant={variant}
          size={size}
          className={className}
          onClick={handleClick}
          disabled={isLoading || disabled}
          {...props}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Building2 className="h-4 w-4 mr-2" />
              Link Bank Account
            </>
          )}
        </Button>
        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}
      </>
    );
  }
);
PlaidLinkButton.displayName = 'PlaidLinkButton';
