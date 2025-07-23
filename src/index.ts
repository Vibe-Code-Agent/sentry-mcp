#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { SentryService } from './services/SentryService.js';
import { CodebaseAnalyzer } from './services/CodebaseAnalyzer.js';
import { IssueInvestigator } from './services/IssueInvestigator.js';

export class SentryInvestigatorServer {
  private server: Server;
  private sentryService: SentryService;
  private codebaseAnalyzer: CodebaseAnalyzer;
  private issueInvestigator: IssueInvestigator;

  constructor() {
    this.server = new Server(
      {
        name: 'sentry-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.sentryService = new SentryService();
    this.codebaseAnalyzer = new CodebaseAnalyzer();
    this.issueInvestigator = new IssueInvestigator(this.sentryService, this.codebaseAnalyzer);

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_sentry_issues',
            description: 'Fetch recent issues from Sentry for investigation',
            inputSchema: {
              type: 'object',
              properties: {
                project: {
                  type: 'string',
                  description: 'Sentry project slug (optional, uses default if not provided)',
                },
                limit: {
                  type: 'number',
                  description: 'Number of issues to fetch (default: 10, max: 100)',
                  default: 10,
                },
                status: {
                  type: 'string',
                  description: 'Issue status filter (unresolved, resolved, ignored)',
                  enum: ['unresolved', 'resolved', 'ignored'],
                  default: 'unresolved',
                },
              },
            },
          },
          {
            name: 'investigate_issue',
            description: 'Investigate a specific Sentry issue by analyzing the codebase and providing explanations and fixes',
            inputSchema: {
              type: 'object',
              properties: {
                issue_id: {
                  type: 'string',
                  description: 'Sentry issue ID to investigate (supports both full IDs like "4567890123" and short IDs like "ATS-3YJ")',
                },
                codebase_path: {
                  type: 'string',
                  description: 'Path to the codebase to analyze (default: current directory)',
                  default: '.',
                },
                include_fix: {
                  type: 'boolean',
                  description: 'Whether to provide code fix suggestions',
                  default: true,
                },
              },
              required: ['issue_id'],
            },
          },
          {
            name: 'analyze_stack_trace',
            description: 'Analyze a stack trace and find related code in the codebase',
            inputSchema: {
              type: 'object',
              properties: {
                stack_trace: {
                  type: 'string',
                  description: 'Stack trace to analyze',
                },
                codebase_path: {
                  type: 'string',
                  description: 'Path to the codebase to analyze (default: current directory)',
                  default: '.',
                },
              },
              required: ['stack_trace'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_sentry_issues':
            return await this.getSentryIssues(args as any);

          case 'investigate_issue':
            return await this.investigateIssue(args as any);

          case 'analyze_stack_trace':
            return await this.analyzeStackTrace(args as any);

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${errorMessage}`
        );
      }
    });
  }

  private async getSentryIssues(args: {
    project?: string;
    limit?: number;
    status?: 'unresolved' | 'resolved' | 'ignored';
  }) {
    const issues = await this.sentryService.getIssues({
      project: args.project,
      limit: args.limit || 10,
      status: args.status || 'unresolved',
    });

    if (issues.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No ${args.status || 'unresolved'} issues found in the specified project.`,
          },
        ],
      };
    }

    const issueList = issues.map((issue, index) => {
      return `${index + 1}. **${issue.title}**\n` +
             `   ID: ${issue.id}\n` +
             `   Status: ${issue.status}\n` +
             `   Level: ${issue.level}\n` +
             `   Count: ${issue.count} occurrences\n` +
             `   First Seen: ${new Date(issue.firstSeen).toLocaleString()}\n` +
             `   Last Seen: ${new Date(issue.lastSeen).toLocaleString()}\n` +
             `   URL: ${issue.permalink}\n`;
    }).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `## 🐛 Sentry Issues (${issues.length} found)\n\n${issueList}\n\n` +
                `💡 Use the \`investigate_issue\` tool with an issue ID to get detailed analysis and potential fixes.`,
        },
      ],
    };
  }

  private async investigateIssue(args: {
    issue_id: string;
    codebase_path?: string;
    include_fix?: boolean;
  }) {
    const investigation = await this.issueInvestigator.investigate(
      args.issue_id,
      args.codebase_path || '.',
      args.include_fix !== false
    );

    return {
      content: [
        {
          type: 'text',
          text: investigation,
        },
      ],
    };
  }

  private async analyzeStackTrace(args: {
    stack_trace: string;
    codebase_path?: string;
  }) {
    const analysis = await this.codebaseAnalyzer.analyzeStackTrace(
      args.stack_trace,
      args.codebase_path || '.'
    );

    return {
      content: [
        {
          type: 'text',
          text: analysis,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Sentry Investigator MCP server running on stdio');
  }
}

const server = new SentryInvestigatorServer();
server.run().catch(console.error); 
