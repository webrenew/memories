type SentryLikeStackFrame = {
  abs_path?: string
  filename?: string
  function?: string
}

type SentryLikeException = {
  stacktrace?: {
    frames?: SentryLikeStackFrame[]
  }
  type?: string
  value?: string
}

type SentryLikeBreadcrumb = {
  category?: string
  data?: Record<string, unknown>
  message?: string
}

type SentryLikeErrorEvent = {
  breadcrumbs?: SentryLikeBreadcrumb[]
  exception?: {
    values?: SentryLikeException[]
  }
  message?: string
}

const INJECTED_HOST_PREFIX = "[jshost]"
const NULL_TAG_NAME_MESSAGE = "Cannot read properties of null (reading 'tagName')"

function valueToSearchText(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (value instanceof Error) {
    return `${value.name} ${value.message} ${value.stack ?? ""}`
  }

  if (value && typeof value === "object") {
    const errorLike = value as { message?: unknown; name?: unknown; stack?: unknown }
    return [errorLike.name, errorLike.message, errorLike.stack].filter(Boolean).join(" ")
  }

  return ""
}

function breadcrumbText(breadcrumb: SentryLikeBreadcrumb): string {
  const args = breadcrumb.data?.arguments
  const argText = Array.isArray(args) ? args.map(valueToSearchText).join(" ") : valueToSearchText(args)

  return [breadcrumb.message, argText, valueToSearchText(breadcrumb.data?.logger)].filter(Boolean).join(" ")
}

function isInjectedHostBreadcrumb(breadcrumb: SentryLikeBreadcrumb): boolean {
  const text = breadcrumbText(breadcrumb)

  return (
    breadcrumb.category === "console" &&
    (text.includes(INJECTED_HOST_PREFIX) ||
      (text.includes(NULL_TAG_NAME_MESSAGE) && text.includes("addEL_hook")) ||
      text.includes("GETJSURL"))
  )
}

function frameText(frame: SentryLikeStackFrame): string {
  return [frame.function, frame.filename, frame.abs_path].filter(Boolean).join(" ")
}

function hasInjectedHostFrame(event: SentryLikeErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap((exception) => exception.stacktrace?.frames ?? []) ?? []
  const text = frames.map(frameText).join(" ")

  return text.includes("addEL_hook") || text.includes("scriptPath (<anonymous>") || text.includes("GETJSURL")
}

function hasInjectedHostHint(hint?: unknown): boolean {
  const text = valueToSearchText((hint as { originalException?: unknown } | undefined)?.originalException)

  return text.includes("addEL_hook") || text.includes(INJECTED_HOST_PREFIX) || text.includes("GETJSURL")
}

function exceptionText(event: SentryLikeErrorEvent, hint?: unknown): string {
  const exceptionValues = event.exception?.values ?? []
  const eventText = [
    event.message,
    ...exceptionValues.flatMap((exception) => [exception.type, exception.value]),
  ]
    .filter(Boolean)
    .join(" ")

  return `${eventText} ${valueToSearchText((hint as { originalException?: unknown } | undefined)?.originalException)}`
}

function isInjectedHostNullTagNameError(event: SentryLikeErrorEvent, hint?: unknown): boolean {
  const text = exceptionText(event, hint)

  if (!text.includes(NULL_TAG_NAME_MESSAGE)) {
    return false
  }

  return (
    hasInjectedHostFrame(event) ||
    hasInjectedHostHint(hint) ||
    event.breadcrumbs?.some(isInjectedHostBreadcrumb) === true
  )
}

export function filterClientSentryBreadcrumb<T extends SentryLikeBreadcrumb>(
  breadcrumb: T
): T | null {
  return isInjectedHostBreadcrumb(breadcrumb) ? null : breadcrumb
}

export function filterClientSentryEvent<T extends SentryLikeErrorEvent>(
  event: T,
  hint?: unknown
): T | null {
  return isInjectedHostNullTagNameError(event, hint) ? null : event
}
