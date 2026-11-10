import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsResponse, McpRequestMessage, ServerConfig } from "./types";
import { z } from "zod";

export async function createClient(
  id: string,
  config: ServerConfig,
): Promise<Client> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: {
      // Keep PATH and basic runtime variables without inheriting application keys.
      ...getDefaultEnvironment(),
      ...(config.env || {}),
    },
  });

  const client = new Client(
    {
      name: `nextchat-mcp-client-${id}`,
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );
  await client.connect(transport);
  return client;
}

export async function removeClient(client: Client) {
  await client.close();
}

export async function listTools(client: Client): Promise<ListToolsResponse> {
  return client.listTools();
}

export async function executeRequest(
  client: Client,
  request: McpRequestMessage,
) {
  return client.request(request, z.any());
}
