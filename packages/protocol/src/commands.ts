// A single argument a command declares, surfaced as one field in the palette's
// arg form. `name` is the placeholder token: "ARGUMENTS" or "1".."9".
export interface AgentCommandArg {
  name: string
  label: string
  required: boolean
}

// A discovered, read-only command trux can resolve and run. `body` is the
// template (frontmatter stripped); `name` is the invocation token without slash
// (e.g. "review" or "frontend:component" for a namespaced subfolder).
export interface AgentCommand {
  name: string
  description: string
  body: string
  args: AgentCommandArg[]
  source: 'file'
}

export interface CommandsResponse {
  commands: AgentCommand[]
}

// Resolve a command template against captured args. Portable subset only:
// $ARGUMENTS and positional $1..$9. Unknown placeholders resolve to '' so a
// half-filled form never leaves a literal $1 in the prompt. $10+ is left alone.
export function resolveCommand(body: string, args: Record<string, string>): string {
  return body
    .replace(/\$ARGUMENTS\b/g, () => args.ARGUMENTS ?? '')
    .replace(/\$([1-9])(?![0-9])/g, (_m, d: string) => args[d] ?? '')
}
