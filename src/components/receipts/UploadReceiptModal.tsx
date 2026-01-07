'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, Camera, Image, X, Check, AlertCircle } from 'lucide-react';

interface ParsedReceiptData {
  vendor?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  tip?: number;
  date?: string;
  paymentMethod?: string;
  lineItems?: Array<{
    description: string;
    amount: number;
  }>;
  rawText: string;
}

interface UploadReceiptModalProps {
  transactionId?: string;
  onSuccess?: (data: ParsedReceiptData) => void;
  trigger?: React.ReactNode;
}

export function UploadReceiptModal({
  transactionId,
  onSuccess,
  trigger,
}: UploadReceiptModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedReceiptData | null>(null);
  const [step, setStep] = useState<'upload' | 'processing' | 'review'>('upload');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((file: File) => {
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!validTypes.includes(file.type)) {
      setError('Please upload a valid image file (JPEG, PNG, WebP, or HEIC)');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload and process
    processReceipt(file);
  }, [transactionId]);

  const processReceipt = async (file: File) => {
    setIsLoading(true);
    setStep('processing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (transactionId) {
        formData.append('transactionId', transactionId);
      }

      const response = await fetch('/api/receipts/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process receipt');
      }

      const data = await response.json();
      setParsedData(data.parsedData);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process receipt');
      setStep('upload');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleConfirm = () => {
    if (parsedData && onSuccess) {
      onSuccess(parsedData);
    }
    handleClose();
  };

  const handleClose = () => {
    setIsOpen(false);
    setPreview(null);
    setParsedData(null);
    setStep('upload');
    setError(null);
  };

  const formatCurrency = (amount: number | undefined) => {
    if (amount === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Upload Receipt
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Upload Receipt'}
            {step === 'processing' && 'Processing Receipt'}
            {step === 'review' && 'Review Extracted Data'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a receipt image to automatically extract transaction details.'}
            {step === 'processing' && 'Analyzing your receipt using OCR...'}
            {step === 'review' && 'Review the extracted information and confirm.'}
          </DialogDescription>
        </DialogHeader>

        {/* Upload Step */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp,image/heic"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
              />
              <Image className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-2">
                Drag and drop a receipt image here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Supports JPEG, PNG, WebP, HEIC (max 10MB)
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="outline" disabled>
                <Camera className="h-4 w-4 mr-2" />
                Use Camera (Coming Soon)
              </Button>
            </div>
          </div>
        )}

        {/* Processing Step */}
        {step === 'processing' && (
          <div className="py-12 text-center">
            <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">
              Extracting text and analyzing receipt...
            </p>
            {preview && (
              <div className="mt-4">
                <img
                  src={preview}
                  alt="Receipt preview"
                  className="max-h-40 mx-auto rounded-lg opacity-50"
                />
              </div>
            )}
          </div>
        )}

        {/* Review Step */}
        {step === 'review' && parsedData && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Preview */}
              {preview && (
                <div className="col-span-1">
                  <img
                    src={preview}
                    alt="Receipt"
                    className="w-full rounded-lg border"
                  />
                </div>
              )}

              {/* Extracted Data */}
              <div className={preview ? 'col-span-1' : 'col-span-2'}>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Vendor</span>
                    <span className="font-medium">{parsedData.vendor || 'Not detected'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Date</span>
                    <span className="font-medium">{parsedData.date || 'Not detected'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Subtotal</span>
                    <span className="font-medium">{formatCurrency(parsedData.subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Tax</span>
                    <span className="font-medium">{formatCurrency(parsedData.tax)}</span>
                  </div>
                  {parsedData.tip !== undefined && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-sm text-muted-foreground">Tip</span>
                      <span className="font-medium">{formatCurrency(parsedData.tip)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground font-medium">Total</span>
                    <span className="font-bold text-lg">{formatCurrency(parsedData.total)}</span>
                  </div>
                  {parsedData.paymentMethod && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-sm text-muted-foreground">Payment Method</span>
                      <span className="font-medium">{parsedData.paymentMethod}</span>
                    </div>
                  )}
                </div>

                {/* Line Items */}
                {parsedData.lineItems && parsedData.lineItems.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium mb-2">Line Items</h4>
                    <div className="bg-muted rounded-lg p-3 max-h-32 overflow-y-auto">
                      {parsedData.lineItems.map((item, index) => (
                        <div key={index} className="flex justify-between text-sm py-1">
                          <span className="truncate mr-2">{item.description}</span>
                          <span>{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('upload')}>
                <X className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              <Button onClick={handleConfirm}>
                <Check className="h-4 w-4 mr-2" />
                Confirm & Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
