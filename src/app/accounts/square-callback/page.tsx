'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

function SquareCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = React.useState('Connecting your Square account...');

  React.useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        setStatus('error');
        setMessage(searchParams.get('error_description') || 'Failed to connect Square');
        return;
      }

      if (!code || !state) {
        setStatus('error');
        setMessage('Invalid callback - missing authorization code');
        return;
      }

      // Verify state matches what we stored
      const storedState = sessionStorage.getItem('square_oauth_state');
      if (storedState && storedState !== state) {
        setStatus('error');
        setMessage('Security verification failed - please try again');
        return;
      }

      try {
        // The callback API route handles the token exchange
        // We just need to show success since the API route already ran
        sessionStorage.removeItem('square_oauth_state');
        setStatus('success');
        setMessage('Square account connected successfully!');

        // Redirect after a short delay
        setTimeout(() => {
          router.push('/accounts');
        }, 2000);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to complete connection');
      }
    };

    handleCallback();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            {status === 'loading' && <Loader2 className="h-6 w-6 animate-spin" />}
            {status === 'success' && <CheckCircle className="h-6 w-6 text-green-500" />}
            {status === 'error' && <XCircle className="h-6 w-6 text-red-500" />}
            {status === 'loading' && 'Connecting Square'}
            {status === 'success' && 'Connected!'}
            {status === 'error' && 'Connection Failed'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          {status === 'success' && (
            <p className="text-sm text-muted-foreground mb-4">
              Redirecting to your accounts...
            </p>
          )}
          {status === 'error' && (
            <div className="space-y-4">
              <Button asChild>
                <Link href="/accounts">Return to Accounts</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SquareCallbackPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen" />}>
      <SquareCallbackContent />
    </React.Suspense>
  );
}
