interface ErrorLayoutProps {
  error?: Error;
  onRetry?: () => void;
}

export function ErrorLayout({ error, onRetry }: ErrorLayoutProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-lg font-semibold text-destructive">
        Something went wrong
      </h2>
      {error && (
        <p className="max-w-md text-sm text-muted-foreground">
          {error.message}
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
