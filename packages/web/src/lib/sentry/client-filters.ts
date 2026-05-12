import type { Breadcrumb, BreadcrumbHint, ErrorEvent, EventHint, StackFrame } from "@sentry/nextjs"

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

function breadcrumbText(breadcrumb: Breadcrumb): string {
  const args = breadcrumb.data?.arguments
  const argText = Array.isArray(args) ? args.map(valueToSearchText).join(" ") : valueToSearchText(args)

  return [breadcrumb.message, argText, valueToSearchText(breadcrumb.data?.logger)].filter(Boolean).join(" ")
}

function isInjectedHostBreadcrumb(breadcrumb: Breadcrumb): boolean {
  const text = breadcrumbText(breadcrumb)

  return (
    breadcrumb.category === "console" &&
    (text.includes(INJECTED_HOST_PREFIX) ||
      (text.includes(NULL_TAG_NAME_MESSAGE) && text.includes("addEL_hook")) ||
      text.includes("GETJSURL"))
  )
}

function frameText(frame: StackFrame): string {
  return [frame.function, frame.filename, frame.abs_path].filter(Boolean).join(" ")
}

function hasInjectedHostFrame(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap((exception) => exception.stacktrace?.frames ?? []) ?? []
  const text = frames.map(frameText).join(" ")

  return text.includes("addEL_hook") || text.includes("scriptPath (<anonymous>") || text.includes("GETJSURL")
}

function hasInjectedHostHint(hint: EventHint): boolean {
  const text = valueToSearchText(hint.originalException)

  return text.includes("addEL_hook") || text.includes(INJECTED_HOST_PREFIX) || text.includes("GETJSURL")
}

function exceptionText(event: ErrorEvent, hint: EventHint): string {
  const exceptionValues = event.exception?.values ?? []
  const eventText = [
    event.message,
    ...exceptionValues.flatMap((exception) => [exception.type, exception.value]),
  ]
    .filter(Boolean)
    .join(" ")

  return [eventText, valueToSearchText(hint.originalException)].filter(Boolean).join(" ")
}

function isInjectedHostNullTagNameError(event: ErrorEvent, hint: EventHint): boolean {
  const text = exceptionText(event, hint)

  if (!text.includes(NULL_TAG_NAME_MESSAGE)) {
    return false
  }

  // exceptionText gates on the normalized event/originalException message.
  // The checks below separately prove the stack or breadcrumb came from the injected host hook.
  return (
    hasInjectedHostFrame(event) ||
    hasInjectedHostHint(hint) ||
    event.breadcrumbs?.some(isInjectedHostBreadcrumb) === true
  )
}

export function filterClientSentryBreadcrumb(
  breadcrumb: Breadcrumb,
  _hint?: BreadcrumbHint
): Breadcrumb | null {
  return isInjectedHostBreadcrumb(breadcrumb) ? null : breadcrumb
}

export function filterClientSentryEvent(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
  return isInjectedHostNullTagNameError(event, hint) ? null : event
}
