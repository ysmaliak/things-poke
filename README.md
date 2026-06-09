# things-poke

A local MCP server that lets Poke work with Things 3 on macOS.

The server runs on your Mac, talks to Things through its documented AppleScript automation surface, and exposes a Streamable HTTP MCP endpoint at `/mcp` for Poke.

## Quick Start

For normal users:

```bash
npm install -g things-poke && things-poke install
```

That installs the official Things Poke connector, checks Things, asks macOS for Automation permission if needed, starts the local MCP server, and connects it to Poke.

Then ask Poke:

```text
Use my Things integration and show me my Today list.
```

For local development from this repository:

```bash
npm install
npm run build
npm run start
```

In another terminal:

```bash
npm run connect
```

That runs:

```bash
npx poke@latest tunnel http://localhost:8765/mcp -n "Things"
```

Normal users should use `things-poke install` instead of running tunnel commands manually.

## How It Works

Things stores its data locally on each user's Mac, so every user runs their own connector and gets their own Poke tunnel.

```text
User's Poke account
  -> user's Poke tunnel
    -> things-poke running on the user's Mac
      -> Things 3
```

The recipe should tell users to run:

```bash
npm install -g things-poke && things-poke install
```

That command signs in to Poke if needed, starts the local MCP server, creates the user's own tunnel, and keeps both running with macOS LaunchAgents.

## CLI

```bash
things-poke install
things-poke setup
things-poke start
things-poke connect
things-poke connect --recipe
things-poke status
things-poke uninstall
```

`things-poke install` creates user LaunchAgents so the server and tunnel keep running in the background after the terminal exits. Logs are written to `~/.things-poke/logs`.

If you only want the local MCP server without starting a Poke tunnel:

```bash
things-poke install --no-tunnel
```

To create a shareable Poke recipe while installing:

```bash
things-poke install --recipe
```

## Optional Auth

For localhost-only development, auth is off by default. To require a bearer token:

```bash
export THINGS_POKE_API_TOKEN="your-secret"
things-poke start
```

Then connect a remote MCP server with Poke using an API key, or provide the token to whatever tunnel/proxy is forwarding requests.

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `THINGS_POKE_HOST` | `127.0.0.1` | HTTP bind host |
| `THINGS_POKE_PORT` | `8765` | HTTP port |
| `THINGS_POKE_API_TOKEN` | empty | Optional bearer token |

## Scope

This project aims to expose the native Things concepts Poke needs: to-dos, projects, areas, tags, built-in lists, scheduling, deadlines, completion/cancelation, moving, showing/editing, quick entry, logging completed items, and trash operations.

Things only exposes some app behavior through AppleScript and URL schemes. If a feature is not scriptable by Things, the MCP server cannot perform it reliably.
