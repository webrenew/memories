# MCP Client Setup Reference

Copy-paste configurations for every supported client.

## Table of Contents

- [Claude Code](#claude-code)
- [Claude Desktop](#claude-desktop)
- [Cursor](#cursor)
- [Windsurf](#windsurf)
- [VS Code](#vs-code)
- [v0 / Web Tools](#v0--web-tools)
- [OpenCode](#opencode)
- [Factory](#factory)
- [Local-Only (No Cloud)](#local-only-no-cloud)

---

## Claude Code

Run in terminal:

```bash
claude mcp add memories -e API_KEY=YOUR_API_KEY -- npx -y @memories.sh/cli serve --api-key "$API_KEY"
```

Or add to `.mcp.json` (project root) or `~/.mcp.json` (global):

```json
{
  "mcpServers": {
    "memories": {
      "command": "npx",
      "args": ["-y", "@memories.sh/cli", "serve", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```

**Best practice**: Use both generated `CLAUDE.md` (static baseline) + MCP (live access).

---

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "memories": {
      "command": "npx",
      "args": ["-y", "@memories.sh/cli", "serve", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

**Stdio transport (recommended):**

```json
{
  "mcpServers": {
    "memories": {
      "command": "npx",
      "args": ["-y", "@memories.sh/cli", "serve", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```

**HTTP transport (alternative):**

```json
{
  "mcpServers": {
    "memories": {
      "url": "https://memories.sh/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

---

## Windsurf

Add to `.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "memories": {
      "url": "https://memories.sh/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

---

## VS Code

Add to `.vscode/mcp.json` (note: uses `servers` not `mcpServers`):

```json
{
  "servers": {
    "memories": {
      "url": "https://memories.sh/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

---

## v0 / Web Tools

Paste these into the MCP settings:

- **Endpoint:** `https://memories.sh/api/mcp`
- **Headers:** `Authorization: Bearer YOUR_API_KEY`

---

## OpenCode

Add to `.opencode/mcp.json`:

```json
{
  "mcpServers": {
    "memories": {
      "command": "npx",
      "args": ["-y", "@memories.sh/cli", "serve", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```

---

## Factory

Add to `.factory/mcp.json`:

```json
{
  "mcpServers": {
    "memories": {
      "command": "npx",
      "args": ["-y", "@memories.sh/cli", "serve", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```

---

## Local-Only (No Cloud)

For air-gapped or offline environments, omit the `--api-key` flag:

```bash
memories init    # Auto-detects and configures tools
memories serve   # Start local MCP server
```

Manual config (any client):

```json
{
  "mcpServers": {
    "memories": {
      "command": "npx",
      "args": ["-y", "@memories.sh/cli", "serve"]
    }
  }
}
```

### Cloud vs Local

| Feature | Cloud MCP | Local MCP |
|---------|-----------|-----------|
| Sync across devices | Yes | No |
| Works offline | No | Yes |
| No local install needed | Yes | No |
| Air-gapped environments | No | Yes |
| Web-based tools (v0) | Yes | No |
