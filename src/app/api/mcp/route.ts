import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { authenticateApiRequest } from "@/server/api-auth";
import { MCP_TOOLS, MCP_TOOLS_BY_NAME } from "@/server/mcp-tools";

/**
 * MCP server over HTTP — the machine-facing API.
 *
 *   POST /api/mcp
 *   Authorization: Bearer $NOTARIUM_API_TOKEN
 *   { "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
 *
 * This is the Streamable HTTP transport with the streaming half left out.
 * That transport is JSON-RPC 2.0 over POST, plus an optional GET that holds an
 * SSE channel open for server-initiated messages. This server never initiates
 * anything — it answers `tools/call` and returns — so GET is a 405 (which the
 * spec allows) and every POST gets an ordinary JSON response rather than an
 * SSE stream.
 *
 * Hand-rolled rather than built on `@modelcontextprotocol/sdk`: its
 * `StreamableHTTPServerTransport` wants Node `req`/`res` objects, and App
 * Router handlers receive Web `Request`/`Response`. The adapter to bridge
 * those would be more code than the four methods below, and would add a
 * dependency to carry a stateless server that fits on one screen.
 *
 * The session layer is deliberately absent too. `Mcp-Session-Id` is optional
 * in the spec, and there is no per-connection state here worth keeping —
 * every call authenticates and resolves its owner independently.
 */

/** Node runtime: the repo layer imports `server-only` modules and the DB driver. */
export const runtime = "nodejs";

/** The MCP revision whose shapes this implements. */
const PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = { name: "notarium", version: "1.0.0" };

// JSON-RPC 2.0 error codes, plus the one application code we raise.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}

function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Dispatch one JSON-RPC message. Returns null for notifications (no `id`),
 * which per the spec get no response body at all.
 */
async function dispatch(
  message: JsonRpcRequest,
  ownerId: string,
): Promise<object | null> {
  const id = message.id ?? null;
  const method = typeof message.method === "string" ? message.method : "";
  const isNotification = message.id === undefined || message.id === null;

  // Notifications are fire-and-forget. `notifications/initialized` is the only
  // one a client sends us; anything else is safely ignored rather than
  // answered with an error the client isn't listening for.
  if (isNotification) return null;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const params = (message.params ?? {}) as {
        name?: unknown;
        arguments?: unknown;
      };
      const name = typeof params.name === "string" ? params.name : "";
      const tool = MCP_TOOLS_BY_NAME.get(name);
      if (!tool) {
        return error(id, METHOD_NOT_FOUND, `Unknown tool: ${name || "(none)"}`);
      }
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const value = await tool.handler(ownerId, args);
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        });
      } catch (err) {
        // A failing tool is a TOOL error, not a protocol error: it comes back
        // as a successful result carrying isError, so the model can read what
        // went wrong and try something else instead of the client treating the
        // whole connection as broken.
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`[mcp] ${name} failed:`, err);
        return result(id, {
          content: [{ type: "text", text: `Error: ${detail}` }],
          isError: true,
        });
      }
    }

    default:
      return error(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

export async function POST(req: Request) {
  const auth = authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!isDbConfigured) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(error(null, PARSE_ERROR, "Invalid JSON"), {
      status: 400,
    });
  }

  // A client may batch several messages into one array.
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as JsonRpcRequest[];
  if (messages.length === 0 || messages.some((m) => typeof m !== "object" || m === null)) {
    return NextResponse.json(
      error(null, INVALID_REQUEST, "Expected a JSON-RPC message or array"),
      { status: 400 },
    );
  }

  const responses: object[] = [];
  for (const message of messages) {
    try {
      const response = await dispatch(message, auth.ownerId);
      if (response) responses.push(response);
    } catch (err) {
      console.error("[mcp] dispatch failed:", err);
      responses.push(
        error(message.id ?? null, INTERNAL_ERROR, "Internal error"),
      );
    }
  }

  // All-notifications batch: 202 with no body, per the transport spec.
  if (responses.length === 0) return new Response(null, { status: 202 });
  return NextResponse.json(batch ? responses : responses[0]);
}

/**
 * The spec's optional server→client SSE channel. This server has nothing to
 * push, and saying so is better than holding a connection open forever.
 */
export function GET() {
  return NextResponse.json(
    { error: "This MCP server does not offer a server-initiated event stream." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
