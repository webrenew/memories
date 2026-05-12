import * as Sentry from "@sentry/nextjs";
import { filterClientSentryBreadcrumb, filterClientSentryEvent } from "@/lib/sentry/client-filters";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "development",
  integrations: [Sentry.replayIntegration()],
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  beforeBreadcrumb: filterClientSentryBreadcrumb,
  beforeSend: filterClientSentryEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
