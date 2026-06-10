#!/usr/bin/env node
import { Command } from "commander";
import { execFile, spawn } from "node:child_process";
import { access, chmod, copyFile, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
async function runSetup(options) {
    await access("/usr/bin/osascript", constants.X_OK);
    console.log("OK osascript is available");
    await access("/Applications/Things3.app", constants.R_OK);
    console.log("OK Things3.app found in /Applications");
    if (options.touchThings) {
        const version = await getVersion();
        console.log(`OK Things responded: ${version}`);
    }
}
async function ensureDedicatedNode() {
    const binDir = join(stateDir, "bin");
    const binPath = join(binDir, "things-poke-node");
    const sourcePath = await realpath(process.execPath);
    const smokeTest = async () => {
        const result = await execFileAsync(binPath, ["--version"], { rejectOnError: false });
        return result.code === 0;
    };
    try {
        await access(binPath, constants.X_OK);
        if (await smokeTest()) {
            return binPath;
        }
        await rm(binPath, { force: true });
    }
    catch {
        // No usable copy yet.
    }
    await mkdir(binDir, { recursive: true });
    await copyFile(sourcePath, binPath);
    await chmod(binPath, 0o755);
    if (await smokeTest()) {
        console.log(`OK dedicated runtime at ${binPath}`);
        return binPath;
    }
    await rm(binPath, { force: true });
    console.warn(`Warning: your node binary (${sourcePath}) is not relocatable; using it directly. Upgrading node may require rerunning \`things-poke install\`.`);
    return sourcePath;
}
async function waitForServer(port) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) });
            if (response.ok) {
                return;
            }
        }
        catch {
            // Server not up yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Server did not respond on port ${port} within 15s. Check logs in ${logDir}.`);
}
async function authorizeAutomation(port) {
    console.log("");
    console.log("Requesting macOS Automation permission for the background service...");
    console.log("macOS will show a dialog: \"things-poke-node\" wants access to control \"Things3\". Click Allow.");
    console.log("Waiting up to 2 minutes...");
    let result;
    try {
        const response = await fetch(`http://127.0.0.1:${port}/health/automation?timeoutMs=120000`, {
            signal: AbortSignal.timeout(130_000),
        });
        result = (await response.json());
    }
    catch (error) {
        result = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
    if (result.status === "granted") {
        console.log(`OK Automation permission granted (Things ${result.appVersion}). You will not be asked again.`);
        return true;
    }
    console.error("");
    console.error(`Automation permission was not granted (${result.status}).`);
    if (result.message) {
        console.error(result.message);
    }
    console.error("To fix: open System Settings > Privacy & Security > Automation, enable Things3 under \"things-poke-node\", then rerun `things-poke install`.");
    console.error("If no toggle appears there, run `tccutil reset AppleEvents` and rerun `things-poke install`.");
    return false;
}
function xmlEscape(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&apos;");
}
function userDomain() {
    return `gui/${process.getuid?.() ?? ""}`;
}
function execFileAsync(file, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, (error, stdout, stderr) => {
            const rawCode = error?.code;
            const code = error ? (typeof rawCode === "number" ? rawCode : 1) : 0;
            if (error && options.rejectOnError !== false) {
                reject(new Error(stderr || stdout || error.message));
                return;
            }
            resolve({ stdout, stderr, code });
        });
    });
}
function shellQuote(value) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
async function runInteractive(command, args) {
    await new Promise((resolve, reject) => {
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
async function bootout(label, plistPath) {
    await execFileAsync("launchctl", ["bootout", userDomain(), plistPath], { rejectOnError: false });
    await execFileAsync("launchctl", ["bootout", userDomain(), label], { rejectOnError: false });
}
async function stopLegacyServices() {
    const oldServerPlist = join(launchAgentsDir, `${legacyServerLabel}.plist`);
    const oldTunnelPlist = join(launchAgentsDir, `${legacyTunnelLabel}.plist`);
    await bootout(legacyTunnelLabel, oldTunnelPlist);
    await bootout(legacyServerLabel, oldServerPlist);
}
async function bootstrap(label, plistPath) {
    await bootout(label, plistPath);
    await execFileAsync("launchctl", ["bootstrap", userDomain(), plistPath]);
    await execFileAsync("launchctl", ["kickstart", "-k", `${userDomain()}/${label}`], { rejectOnError: false });
}
async function writeLaunchAgent(path, body) {
    await writeFile(path, body, "utf8");
}
function plist(label, args, stdout, stderr, env = {}) {
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
async function installServices(options) {
    await runSetup({ touchThings: false });
    if (options.tunnel) {
        await ensurePokeLogin();
    }
    await mkdir(logDir, { recursive: true });
    await mkdir(launchAgentsDir, { recursive: true });
    await stopLegacyServices();
    const nodeBin = await ensureDedicatedNode();
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
    await writeLaunchAgent(serverPlistPath, plist(serverLabel, [nodeBin, cliPath, "start", "--host", options.host, "--port", options.port], join(logDir, "server.log"), join(logDir, "server.error.log"), {
        THINGS_POKE_HOST: options.host,
        THINGS_POKE_PORT: options.port,
    }));
    await bootstrap(serverLabel, serverPlistPath);
    console.log(`OK installed and started ${serverLabel}`);
    await waitForServer(options.port);
    const authorized = await authorizeAutomation(options.port);
    if (!authorized) {
        console.error("Skipping tunnel setup until Automation permission is granted.");
        process.exitCode = 1;
        return;
    }
    if (options.tunnel) {
        await writeLaunchAgent(tunnelPlistPath, plist(tunnelLabel, ["/bin/zsh", "-lc", tunnelCommand], join(logDir, "tunnel.log"), join(logDir, "tunnel.error.log")));
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
        }
        else {
            console.log(`${label}: not installed or not loaded`);
        }
    }
    try {
        const serverLog = await readFile(join(logDir, "server.log"), "utf8");
        console.log(`\nLast server log:\n${serverLog.trim().split("\n").slice(-4).join("\n")}`);
    }
    catch {
        // No logs yet.
    }
}
program
    .name("things-poke")
    .description("Local Things 3 MCP server for Poke")
    .version("0.1.1");
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
    .action((options) => {
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
    .action((options) => {
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
    .action((options) => installServices(options));
program
    .command("uninstall")
    .description("Stop launchd services created by things-poke install")
    .action(uninstallServices);
program
    .command("status")
    .description("Show launchd service state and recent logs")
    .action(status);
await program.parseAsync();
