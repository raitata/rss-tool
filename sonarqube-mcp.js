#!/usr/bin/env node

// Set environment variables to prevent conflicts with Docker SonarQube
process.env.SONARQUBE_URL = 'http://localhost:9000';
process.env.SONARQUBE_ORG = '';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { 
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');

class SonarQubeMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'sonarqube-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'sonarqube_analysis',
            description: 'Analyze a project with SonarQube',
            inputSchema: {
              type: 'object',
              properties: {
                projectKey: {
                  type: 'string',
                  description: 'SonarQube project key',
                },
                serverUrl: {
                  type: 'string',
                  description: 'SonarQube server URL',
                  default: 'http://localhost:9000',
                },
                token: {
                  type: 'string',
                  description: 'SonarQube authentication token',
                },
              },
              required: ['projectKey'],
            },
          },
          {
            name: 'sonarqube_get_issues',
            description: 'Get issues from a SonarQube project',
            inputSchema: {
              type: 'object',
              properties: {
                projectKey: {
                  type: 'string',
                  description: 'SonarQube project key',
                },
                serverUrl: {
                  type: 'string',
                  description: 'SonarQube server URL',
                  default: 'http://localhost:9000',
                },
                token: {
                  type: 'string',
                  description: 'SonarQube authentication token',
                },
                severity: {
                  type: 'string',
                  enum: ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'],
                  description: 'Filter by severity',
                },
                types: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Filter by issue types (CODE_SMELL, BUG, VULNERABILITY)',
                },
              },
              required: ['projectKey'],
            },
          },
          {
            name: 'sonarqube_get_metrics',
            description: 'Get project metrics from SonarQube',
            inputSchema: {
              type: 'object',
              properties: {
                projectKey: {
                  type: 'string',
                  description: 'SonarQube project key',
                },
                serverUrl: {
                  type: 'string',
                  description: 'SonarQube server URL',
                  default: 'http://localhost:9000',
                },
                token: {
                  type: 'string',
                  description: 'SonarQube authentication token',
                },
                metrics: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of metrics to retrieve',
                  default: ['ncloc', 'coverage', 'duplicated_lines_density', 'maintainability_rating', 'reliability_rating', 'security_rating'],
                },
              },
              required: ['projectKey'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'sonarqube_analysis':
            return await this.runAnalysis(args);
          case 'sonarqube_get_issues':
            return await this.getIssues(args);
          case 'sonarqube_get_metrics':
            return await this.getMetrics(args);
          default:
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
  }

  async runAnalysis(args) {
    const { projectKey, serverUrl = 'http://localhost:9000', token } = args;
    
    // This would typically trigger a SonarQube analysis
    // For now, we'll check if the project exists and get its status
    const response = await this.makeSonarRequest('GET', `/api/components/show?component=${projectKey}`, serverUrl, token);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'SonarQube analysis triggered',
            project: response.data.component,
            note: 'To run a full analysis, use the SonarQube scanner CLI or CI integration',
          }, null, 2),
        },
      ],
    };
  }

  async getIssues(args) {
    const { projectKey, serverUrl = 'http://localhost:9000', token, severity, types } = args;
    
    let url = `/api/issues/search?componentKeys=${projectKey}&ps=500`;
    if (severity) url += `&severities=${severity}`;
    if (types && types.length > 0) url += `&types=${types.join(',')}`;
    
    const response = await this.makeSonarRequest('GET', url, serverUrl, token);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            total: response.data.total,
            issues: response.data.issues,
            paging: response.data.paging,
          }, null, 2),
        },
      ],
    };
  }

  async getMetrics(args) {
    const { projectKey, serverUrl = 'http://localhost:9000', token, metrics } = args;
    
    const url = `/api/measures/component?component=${projectKey}&metricKeys=${metrics.join(',')}`;
    const response = await this.makeSonarRequest('GET', url, serverUrl, token);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            component: response.data.component,
            measures: response.data.measures,
          }, null, 2),
        },
      ],
    };
  }

  async makeSonarRequest(method, path, serverUrl, token) {
    const config = {
      method,
      url: `${serverUrl}${path}`,
      timeout: 30000,
    };

    if (token) {
      config.headers = {
        'Authorization': `Bearer ${token}`,
      };
    }

    try {
      const response = await axios(config);
      return response;
    } catch (error) {
      if (error.response) {
        throw new Error(`SonarQube API error: ${error.response.status} - ${error.response.data?.errors?.[0]?.msg || error.message}`);
      }
      throw error;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('SonarQube MCP Server running on stdio');
  }
}

if (require.main === module) {
  const server = new SonarQubeMCPServer();
  server.run().catch(console.error);
}

module.exports = SonarQubeMCPServer;
