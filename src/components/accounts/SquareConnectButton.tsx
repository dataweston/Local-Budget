'use client';

import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

// Square logo SVG component
function SquareLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 7H3c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm0 8H3V9h18v6z"/>
      <rect x="6" y="11" width="4" height="2"/>
    </svg>
  );
}

interface SquareConnectButtonProps extends ButtonProps {
  onSuccess?: () => void;
}

export const SquareConnectButton = React.forwardRef<
  HTMLButtonElement,
  SquareConnectButtonProps
>(
  (
    {
      onSuccess,
      onClick,
      variant = 'default',
      size = 'default',
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const [isLoading, setIsLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const handleConnect = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/square/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error('Failed to initiate Square connection');
        }

        const data = await response.json();

        // Store state for verification (in sessionStorage for simplicity)
        sessionStorage.setItem('square_oauth_state', data.state);

        // Redirect to Square OAuth
        window.location.href = data.authUrl;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
        setIsLoading(false);
      }
    };

    const handleClick = async (
      event: React.MouseEvent<HTMLButtonElement>
    ) => {
      onClick?.(event);
      if (event.defaultPrevented) {
        return;
      }
      await handleConnect();
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
              <SquareLogo className="h-4 w-4 mr-2" />
              Connect Square
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
SquareConnectButton.displayName = 'SquareConnectButton';
