import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs"
import { describe, expect, it } from "vitest"

import { filterClientSentryBreadcrumb, filterClientSentryEvent } from "./client-filters"

const nullTagNameValue = "Cannot read properties of null (reading 'tagName')"

function errorEvent(event: Omit<ErrorEvent, "type">): ErrorEvent {
  return { type: undefined, ...event }
}

describe("client Sentry filters", () => {
  it("drops null tagName errors thrown by the injected browser host listener hook", () => {
    const event = errorEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: nullTagNameValue,
            stacktrace: {
              frames: [
                { function: "tw._handleVisibilityChange", filename: "https://memories.sh/_next/static/chunks/app.js" },
                { function: "top.addEventListener", filename: "<anonymous>" },
                { function: "addEL_hook", filename: "<anonymous>" },
              ],
            },
          },
        ],
      },
    })

    expect(filterClientSentryEvent(event, {})).toBeNull()
  })

  it("drops null tagName errors when the injected host only appears in breadcrumbs", () => {
    const event = errorEvent({
      exception: {
        values: [{ type: "TypeError", value: nullTagNameValue }],
      },
      breadcrumbs: [
        {
          category: "console",
          message: "[jshost]\twindow.onpopstate\tencoded\t\tencoded",
          data: { logger: "console" },
        },
      ],
    })

    expect(filterClientSentryEvent(event, {})).toBeNull()
  })

  it("drops null tagName errors when injected host evidence is only in the Sentry hint", () => {
    const event = errorEvent({
      exception: {
        values: [{ type: "TypeError", value: nullTagNameValue }],
      },
    })
    const originalException = new TypeError(nullTagNameValue)
    originalException.stack = `TypeError: ${nullTagNameValue}
    at addEL_hook (<anonymous>:675:29)
    at top.addEventListener (<anonymous>:695:9)`

    expect(filterClientSentryEvent(event, { originalException })).toBeNull()
  })

  it("keeps same-message app errors without injected host evidence", () => {
    const event = errorEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: nullTagNameValue,
            stacktrace: {
              frames: [
                { function: "renderLabel", filename: "https://memories.sh/_next/static/chunks/app.js" },
              ],
            },
          },
        ],
      },
    })

    expect(filterClientSentryEvent(event, {})).toBe(event)
  })

  it("drops GETJSURL null tagName errors from stack frames", () => {
    const event = errorEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: nullTagNameValue,
            stacktrace: {
              frames: [
                { function: "scriptPath", filename: "<anonymous>" },
                { function: "GETJSURL", filename: "<anonymous>" },
              ],
            },
          },
        ],
      },
    })

    expect(filterClientSentryEvent(event, {})).toBeNull()
  })

  it("drops GETJSURL null tagName errors from Sentry hint evidence", () => {
    const event = errorEvent({
      exception: {
        values: [{ type: "TypeError", value: nullTagNameValue }],
      },
    })
    const originalException = new TypeError(nullTagNameValue)
    originalException.stack = `Error: GETJSURL
    at scriptPath (<anonymous>:174:17)`

    expect(filterClientSentryEvent(event, { originalException })).toBeNull()
  })

  it("drops injected host console breadcrumbs", () => {
    const breadcrumb: Breadcrumb = {
      category: "console",
      message: "[jshost]\teval\tZG9jdW1lbnQuYm9keQ==\tMjU1NDMy",
      data: { logger: "console" },
    }

    expect(filterClientSentryBreadcrumb(breadcrumb)).toBeNull()
  })

  it("drops rrweb console breadcrumbs caused by the same listener hook", () => {
    const breadcrumb: Breadcrumb = {
      category: "console",
      message: "TypeError: Cannot read properties of null (reading 'tagName')",
      data: {
        logger: "console",
        arguments: [
          {
            message: nullTagNameValue,
            stack: `TypeError: ${nullTagNameValue}
    at addEL_hook (<anonymous>:675:29)
    at top.addEventListener (<anonymous>:695:9)
    at rK.startRecording (https://memories.sh/_next/static/chunks/replay.js:2:5903)`,
          },
        ],
      },
    }

    expect(filterClientSentryBreadcrumb(breadcrumb)).toBeNull()
  })

  it("drops GETJSURL console breadcrumbs", () => {
    const breadcrumb: Breadcrumb = {
      category: "console",
      message: "Error: GETJSURL at addEL_hook",
      data: { logger: "console" },
    }

    expect(filterClientSentryBreadcrumb(breadcrumb)).toBeNull()
  })

  it("keeps ordinary console breadcrumbs", () => {
    const breadcrumb: Breadcrumb = {
      category: "console",
      message: "Loaded dashboard",
      data: { logger: "console" },
    }

    expect(filterClientSentryBreadcrumb(breadcrumb)).toBe(breadcrumb)
  })
})
