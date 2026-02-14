import React from "react"
import { redirect } from "next/navigation"

export default function ApiKeysPage(): React.JSX.Element {
  redirect("/app/sdk-projects")
}
