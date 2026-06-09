import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createThingsPokeMcpServer } from "./mcp.js";
function bearerAuth(token) {
    return (req, res, next) => {
        if (!token) {
            next();
            return;
        }
        const authorization = req.header("Authorization") ?? "";
        if (authorization === `Bearer ${token}`) {
            next();
            return;
        }
        res.status(401).json({
            jsonrpc: "2.0",
            error: {
                code: -32001,
                message: "Unauthorized",
            },
            id: null,
        });
    };
}
function isMcpPath(path) {
    return path === "/mcp" || path.endsWith("/mcp");
}
const mcpRoutePattern = /^(?:\/[^/]+)*\/mcp$/;
export function startServer(options = {}) {
    const host = options.host ?? process.env.THINGS_POKE_HOST ?? "127.0.0.1";
    const port = options.port ?? Number.parseInt(process.env.THINGS_POKE_PORT ?? "8765", 10);
    const apiToken = options.apiToken ?? process.env.THINGS_POKE_API_TOKEN;
    const app = createMcpExpressApp({ host });
    app.get("/", (_req, res) => {
        res.json({
            name: "things-poke",
            status: "ok",
            mcp: "/mcp",
            tunnelCompatibleMcp: "/*/mcp",
            auth: apiToken ? "bearer" : "none",
        });
    });
    app.use((req, res, next) => {
        if (!isMcpPath(req.path)) {
            next();
            return;
        }
        bearerAuth(apiToken)(req, res, next);
    });
    app.post(mcpRoutePattern, async (req, res) => {
        const server = createThingsPokeMcpServer();
        try {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            res.on("close", () => {
                transport.close().catch(() => undefined);
                server.close().catch(() => undefined);
            });
        }
        catch (error) {
            console.error("Error handling MCP request:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message: "Internal server error",
                    },
                    id: null,
                });
            }
        }
    });
    app.get(mcpRoutePattern, (_req, res) => {
        res.status(405).json({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: "Method not allowed. POST JSON-RPC requests to /mcp or a tunnel-prefixed /*/mcp path.",
            },
            id: null,
        });
    });
    app.delete(mcpRoutePattern, (_req, res) => {
        res.status(405).json({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: "Method not allowed.",
            },
            id: null,
        });
    });
    const httpServer = app.listen(port, host, () => {
        console.log(`things-poke MCP server listening at http://${host}:${port}/mcp`);
        console.log(apiToken ? "Bearer auth enabled via THINGS_POKE_API_TOKEN" : "Bearer auth disabled for localhost development");
    });
    return httpServer;
}
