#!/usr/bin/env node
import { Command } from "commander";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";
import { getVersion } from "./things.js";

const program = new Command();
const serverLabel = "com.things-poke.server";
const tunnelLabel = "com.things-poke.tunnel";
const legacyServerLabel = "com.ysmaliak.things-poke.server";
const legacyTunnelLabel = "com.ysmaliak.things-poke.tunnel";
const cliPath = fileURLToPath(import.meta.url);
const stateDir = join(homedir(), ".things-poke");
const logDir = join(stateDir, "logs");
const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");

async function runSetup(options: { touchThings?: boolean }) {
  await access("/usr/bin/osascript", constants.X_OK);
  console.log("OK osascript is available");

  await access("/Applications/Things3.app", constants.R_OK);
  console.log("OK Things3.app found in /Applications");

  if (options.touchThings) {
    const version = await getVersion();
    console.log(`OK Things responded: ${version}`);
  } else {
    console.log("Tip: run `things-poke setup --touch-things` to request/check macOS Automation permission.");
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function userDomain(): string {
  return `gui/${process.getuid?.() ?? ""}`;
}

function execFileAsync(file: string, args: string[], options: { rejectOnError?: boolean } = {}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      const rawCode = (error as NodeJS.ErrnoException | null)?.code;
      const code = error ? (typeof rawCode === "number" ? rawCode : 1) : 0;
      if (error && options.rejectOnError !== false) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runInteractive(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function ensurePokeLogin() {
  const whoami = await execFileAsync("npx", ["poke@latest", "whoami"], { rejectOnError: false });
  if (whoami.code === 0) {
    console.log(`OK Poke logged in as ${whoami.stdout.trim()}`);
    return;
  }

  console.log("Poke CLI is not logged in yet. Starting `npx poke@latest login`...");
  await runInteractive("npx", ["poke@latest", "login"]);
}

async function bootout(label: string, plistPath: string) {
  await execFileAsync("launchctl", ["bootout", userDomain(), plistPath], { rejectOnError: false });
  await execFileAsync("launchctl", ["bootout", userDomain(), label], { rejectOnError: false });
}

async function stopLegacyServices() {
  const oldServerPlist = join(launchAgentsDir, `${legacyServerLabel}.plist`);
  const oldTunnelPlist = join(launchAgentsDir, `${legacyTunnelLabel}.plist`);
  await bootout(legacyTunnelLabel, oldTunnelPlist);
  await bootout(legacyServerLabel, oldServerPlist);
}

async function bootstrap(label: string, plistPath: string) {
  await bootout(label, plistPath);
  await execFileAsync("launchctl", ["bootstrap", userDomain(), plistPath]);
  await execFileAsync("launchctl", ["kickstart", "-k", `${userDomain()}/${label}`], { rejectOnError: false });
}

async function writeLaunchAgent(path: string, body: string) {
  await writeFile(path, body, "utf8");
}

function plist(label: string, args: string[], stdout: string, stderr: string, env: Record<string, string> = {}) {
  const envEntries = Object.entries(env)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(stateDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
${envEntries ? `\n${envEntries}` : ""}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderr)}</string>
</dict>
</plist>
`;
}

async function installServices(options: {
  name: string;
  host: string;
  port: string;
  tunnel: boolean;
  recipe?: boolean;
  touchThings?: boolean;
}) {
  await runSetup({ touchThings: options.touchThings ?? true });
  if (options.tunnel) {
    await ensurePokeLogin();
  }

  await mkdir(logDir, { recursive: true });
  await mkdir(launchAgentsDir, { recursive: true });
  await stopLegacyServices();

  const serverPlistPath = join(launchAgentsDir, `${serverLabel}.plist`);
  const tunnelPlistPath = join(launchAgentsDir, `${tunnelLabel}.plist`);
  const url = `http://localhost:${options.port}/mcp`;
  const tunnelCommand = [
    "exec",
    "npx",
    "poke@latest",
    "tunnel",
    url,
    "-n",
    shellQuote(options.name),
    ...(options.recipe ? ["--recipe"] : []),
  ].join(" ");

  await writeLaunchAgent(
    serverPlistPath,
    plist(
      serverLabel,
      [process.execPath, cliPath, "start", "--host", options.host, "--port", options.port],
      join(logDir, "server.log"),
      join(logDir, "server.error.log"),
      {
        THINGS_POKE_HOST: options.host,
        THINGS_POKE_PORT: options.port,
      },
    ),
  );

  await bootstrap(serverLabel, serverPlistPath);
  console.log(`OK installed and started ${serverLabel}`);

  if (options.tunnel) {
    await writeLaunchAgent(
      tunnelPlistPath,
      plist(
        tunnelLabel,
        ["/bin/zsh", "-lc", tunnelCommand],
        join(logDir, "tunnel.log"),
        join(logDir, "tunnel.error.log"),
      ),
    );
    await bootstrap(tunnelLabel, tunnelPlistPath);
    console.log(`OK installed and started ${tunnelLabel}`);
  }

  console.log("");
  console.log("Things Poke is installed.");
  console.log(`Local MCP server: ${url}`);
  console.log(`Logs: ${logDir}`);
  console.log("");
  console.log("Try this in Poke:");
  console.log("Use my Things integration and show me my Today list.");
}

async function uninstallServices() {
  const serverPlistPath = join(launchAgentsDir, `${serverLabel}.plist`);
  const tunnelPlistPath = join(launchAgentsDir, `${tunnelLabel}.plist`);
  await bootout(tunnelLabel, tunnelPlistPath);
  await bootout(serverLabel, serverPlistPath);
  console.log("Stopped Things Poke launch services. Plist files are left in ~/Library/LaunchAgents for inspection.");
}

async function status() {
  for (const label of [serverLabel, tunnelLabel]) {
    const result = await execFileAsync("launchctl", ["print", `${userDomain()}/${label}`], { rejectOnError: false });
    if (result.code === 0) {
      const state = result.stdout.match(/state = ([^\n]+)/)?.[1] ?? "unknown";
      const pid = result.stdout.match(/pid = ([^\n]+)/)?.[1] ?? "not running";
      console.log(`${label}: ${state}, pid ${pid}`);
    } else {
      console.log(`${label}: not installed or not loaded`);
    }
  }

  try {
    const serverLog = await readFile(join(logDir, "server.log"), "utf8");
    console.log(`\nLast server log:\n${serverLog.trim().split("\n").slice(-4).join("\n")}`);
  } catch {
    // No logs yet.
  }
}

program
  .name("things-poke")
  .description("Local Things 3 MCP server for Poke")
  .version("0.1.0");

program
  .command("setup")
  .description("Check local prerequisites for running the Things MCP server")
  .option("--touch-things", "Ask Things for its version, which may trigger macOS Automation permission")
  .action(runSetup);

program
  .command("start")
  .description("Start the local Streamable HTTP MCP server")
  .option("--host <host>", "Host to bind", process.env.THINGS_POKE_HOST ?? "127.0.0.1")
  .option("--port <port>", "Port to bind", process.env.THINGS_POKE_PORT ?? "8765")
  .action((options: { host: string; port: string }) => {
    const server = startServer({
      host: options.host,
      port: Number.parseInt(options.port, 10),
    });

    const shutdown = () => {
      server.close(() => {
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program
  .command("connect")
  .description("Connect the running local MCP server to Poke through the official Poke tunnel")
  .option("--url <url>", "Local MCP server URL", "http://localhost:8765/mcp")
  .option("-n, --name <name>", "Poke integration display name", "Things")
  .option("--recipe", "Ask Poke CLI to create a shareable recipe link")
  .action((options: { url: string; name: string; recipe?: boolean }) => {
    const args = ["poke@latest", "tunnel", options.url, "-n", options.name];
    if (options.recipe) {
      args.push("--recipe");
    }

    console.log(`Running: npx ${args.join(" ")}`);
    const child = spawn("npx", args, {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });

program
  .command("install")
  .description("One-shot install: check Things, create launchd services, start the MCP server, and connect Poke")
  .option("-n, --name <name>", "Poke integration display name", "Things")
  .option("--host <host>", "Host to bind", process.env.THINGS_POKE_HOST ?? "127.0.0.1")
  .option("--port <port>", "Port to bind", process.env.THINGS_POKE_PORT ?? "8765")
  .option("--recipe", "Ask Poke CLI to create a shareable recipe link from the tunnel")
  .option("--no-tunnel", "Only install the local MCP server; do not start the Poke tunnel")
  .option("--no-touch-things", "Do not touch Things during setup")
  .action((options: { name: string; host: string; port: string; recipe?: boolean; tunnel: boolean; touchThings: boolean }) => installServices(options));

program
  .command("uninstall")
  .description("Stop launchd services created by things-poke install")
  .action(uninstallServices);

program
  .command("status")
  .description("Show launchd service state and recent logs")
  .action(status);

await program.parseAsync();
