import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, type ServerContext } from '../../src/server.js';

export interface LinkedClient {
  client: Client;
  close(): Promise<void>;
}

export async function linkClient(ctx: ServerContext): Promise<LinkedClient> {
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'opensdr-test', version: '0.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] }).content;
  return content?.[0]?.text ?? '';
}

export function jsonOf<T = unknown>(result: unknown): T {
  return JSON.parse(textOf(result)) as T;
}
