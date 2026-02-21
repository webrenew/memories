"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>Something went wrong!</h2>
          <button onClick={() => reset()} style={{ marginTop: "1rem" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
