import { input } from "@inquirer/prompts";

export interface TemplateField {
  name: string;
  prompt: string;
  required: boolean;
}

export interface Template {
  name: string;
  description: string;
  type: "rule" | "decision" | "fact" | "note";
  fields: TemplateField[];
  format: (values: Record<string, string>) => string;
}

export const BUILT_IN_TEMPLATES: Template[] = [
  {
    name: "decision",
    description: "Document an architectural or technical decision",
    type: "decision",
    fields: [
      { name: "what", prompt: "What did you decide?", required: true },
      { name: "why", prompt: "Why this choice?", required: true },
      { name: "alternatives", prompt: "What alternatives were considered? (optional)", required: false },
    ],
    format: (v) => {
      let result = `${v.what}. Rationale: ${v.why}`;
      if (v.alternatives) result += `. Alternatives considered: ${v.alternatives}`;
      return result;
    },
  },
  {
    name: "error-fix",
    description: "Document a bug and its solution",
    type: "fact",
    fields: [
      { name: "error", prompt: "What was the error/bug?", required: true },
      { name: "cause", prompt: "What caused it?", required: true },
      { name: "solution", prompt: "How did you fix it?", required: true },
    ],
    format: (v) => `Bug: ${v.error}. Cause: ${v.cause}. Fix: ${v.solution}`,
  },
  {
    name: "api-endpoint",
    description: "Document an API endpoint",
    type: "fact",
    fields: [
      { name: "method", prompt: "HTTP method (GET, POST, etc.)?", required: true },
      { name: "path", prompt: "Endpoint path?", required: true },
      { name: "description", prompt: "What does it do?", required: true },
      { name: "notes", prompt: "Any important notes? (optional)", required: false },
    ],
    format: (v) => {
      let result = `${v.method.toUpperCase()} ${v.path} - ${v.description}`;
      if (v.notes) result += `. Note: ${v.notes}`;
      return result;
    },
  },
  {
    name: "dependency",
    description: "Document why a dependency was added",
    type: "decision",
    fields: [
      { name: "name", prompt: "Package/library name?", required: true },
      { name: "purpose", prompt: "Why do we use it?", required: true },
      { name: "version", prompt: "Version constraint? (optional)", required: false },
    ],
    format: (v) => {
      let result = `Using ${v.name} for ${v.purpose}`;
      if (v.version) result += ` (${v.version})`;
      return result;
    },
  },
  {
    name: "pattern",
    description: "Document a code pattern or convention",
    type: "rule",
    fields: [
      { name: "name", prompt: "Pattern name?", required: true },
      { name: "when", prompt: "When to use it?", required: true },
      { name: "example", prompt: "Brief example? (optional)", required: false },
    ],
    format: (v) => {
      let result = `${v.name}: ${v.when}`;
      if (v.example) result += `. Example: ${v.example}`;
      return result;
    },
  },
  {
    name: "gotcha",
    description: "Document a non-obvious issue or gotcha",
    type: "fact",
    fields: [
      { name: "issue", prompt: "What's the gotcha?", required: true },
      { name: "context", prompt: "When does it happen?", required: true },
      { name: "workaround", prompt: "How to avoid/handle it?", required: false },
    ],
    format: (v) => {
      let result = `Gotcha: ${v.issue} (${v.context})`;
      if (v.workaround) result += `. Workaround: ${v.workaround}`;
      return result;
    },
  },
];

export function getTemplate(name: string): Template | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.name === name);
}

export function listTemplates(): Template[] {
  return BUILT_IN_TEMPLATES;
}

export async function fillTemplate(template: Template): Promise<string> {
  const values: Record<string, string> = {};

  for (const field of template.fields) {
    const value = await input({
      message: field.prompt,
      validate: (v) => {
        if (field.required && !v.trim()) return "This field is required";
        return true;
      },
    });
    if (value.trim()) {
      values[field.name] = value.trim();
    }
  }

  return template.format(values);
}
