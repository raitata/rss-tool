#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { 
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');

const server = new Server(
  {
    name: 'fetch-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetch_url',
        description: 'Fetch content from a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch',
            },
            method: {
              type: 'string',
              enum: ['GET', 'POST'],
              default: 'GET',
              description: 'HTTP method to use',
            },
            headers: {
              type: 'object',
              description: 'Optional headers to send',
            },
            body: {
              type: 'string',
              description: 'Optional request body for POST requests',
            },
          },
          required: ['url'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'fetch_url') {
      const { url, method = 'GET', headers = {}, body } = args;
      
      const config = {
        method,
        url,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MCP-Fetch-Server/1.0)',
          ...headers,
        },
        timeout: 30000,
      };

      if (body && method === 'POST') {
        config.data = body;
      }

      const response = await axios(config);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              data: response.data,
            }, null, 2),
          },
        ],
      };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            stack: error.stack,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Fetch MCP Server running on stdio');
}

if (require.main === module) {
  main().catch(console.error);
}
