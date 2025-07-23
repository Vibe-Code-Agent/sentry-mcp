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
import { JiraService } from './services/JiraService.js';

export class SentryInvestigatorServer {
  private server: Server;
  private sentryService: SentryService;
  private codebaseAnalyzer: CodebaseAnalyzer;
  private issueInvestigator: IssueInvestigator;
  private jiraService: JiraService;

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
    this.jiraService = new JiraService();

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
          {
            name: 'get_jira_boards',
            description: 'Get list of available Jira boards for ticket creation',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'create_jira_ticket',
            description: 'Create a Jira ticket from a Sentry issue and link them together',
            inputSchema: {
              type: 'object',
              properties: {
                board_id: {
                  type: 'number',
                  description: 'Jira board ID where the ticket should be created',
                },
                summary: {
                  type: 'string',
                  description: 'Ticket summary/title',
                },
                description: {
                  type: 'string',
                  description: 'Detailed description of the issue',
                },
                issue_type: {
                  type: 'string',
                  description: 'Jira issue type ID (use get_issue_types to find available types)',
                },
                priority: {
                  type: 'string',
                  description: 'Issue priority (e.g., High, Medium, Low)',
                },
                labels: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                  description: 'Array of labels to add to the ticket',
                },
                sentry_issue_url: {
                  type: 'string',
                  description: 'URL of the Sentry issue to link',
                },
                sentry_issue_id: {
                  type: 'string',
                  description: 'Sentry issue ID to link back to (creates bidirectional link)',
                },
              },
              required: ['board_id', 'summary', 'description', 'issue_type'],
            },
          },
          {
            name: 'get_issue_types',
            description: 'Get available issue types for a Jira project',
            inputSchema: {
              type: 'object',
              properties: {
                project_key: {
                  type: 'string',
                  description: 'Jira project key (e.g., PROJ)',
                },
              },
              required: ['project_key'],
            },
          },
          {
            name: 'create_jira_from_sentry',
            description: 'Create a Jira ticket directly from a Sentry issue with automatic linking and rich context',
            inputSchema: {
              type: 'object',
              properties: {
                sentry_issue_id: {
                  type: 'string',
                  description: 'Sentry issue ID to create Jira ticket from',
                },
                board_id: {
                  type: 'number',
                  description: 'Jira board ID where the ticket should be created',
                },
                issue_type: {
                  type: 'string',
                  description: 'Jira issue type ID',
                },
                priority: {
                  type: 'string',
                  description: 'Issue priority (e.g., High, Medium, Low)',
                },
                custom_summary: {
                  type: 'string',
                  description: 'Custom summary (optional, will use Sentry issue title if not provided)',
                },
                additional_description: {
                  type: 'string',
                  description: 'Additional description to append to the auto-generated content',
                },
                labels: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                  description: 'Array of labels to add to the ticket',
                },
              },
              required: ['sentry_issue_id', 'board_id', 'issue_type'],
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

          case 'get_jira_boards':
            return await this.getJiraBoards();

          case 'create_jira_ticket':
            return await this.createJiraTicket(args as any);

          case 'get_issue_types':
            return await this.getIssueTypes(args as any);

          case 'create_jira_from_sentry':
            return await this.createJiraFromSentry(args as any);

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

  private async getJiraBoards() {
    if (!this.jiraService.isConfigured()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Jira is not configured. Please set JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.',
          },
        ],
      };
    }

    try {
      const boards = await this.jiraService.getBoards();
      
      if (boards.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No Jira boards found.',
            },
          ],
        };
      }

      const boardList = boards.map((board, index) => {
        return `${index + 1}. **${board.name}** (${board.type})\n` +
               `   ID: ${board.id}\n` +
               `   Project: ${board.location.projectName} (${board.location.projectKey})\n`;
      }).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `## 📋 Available Jira Boards (${boards.length} found)\n\n${boardList}\n\n` +
                  `💡 Use the board ID with \`create_jira_ticket\` to create tickets on the selected board.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching Jira boards: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async createJiraTicket(args: {
    board_id: number;
    summary: string;
    description: string;
    issue_type: string;
    priority?: string;
    labels?: string[];
    sentry_issue_url?: string;
    sentry_issue_id?: string;
  }) {
    if (!this.jiraService.isConfigured()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Jira is not configured. Please set JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.',
          },
        ],
      };
    }

    try {
      const ticket = await this.jiraService.createTicket({
        boardId: args.board_id,
        summary: args.summary,
        description: args.description,
        issueType: args.issue_type,
        priority: args.priority,
        labels: args.labels,
        sentryIssueUrl: args.sentry_issue_url,
      });

      const ticketUrl = this.jiraService.getTicketUrl(ticket.key);
      let linkingResults: string[] = [];

      // Link back to Sentry if issue ID is provided
      if (args.sentry_issue_id && this.sentryService.isConfigured()) {
        try {
          await this.sentryService.linkExternalIssue(args.sentry_issue_id, {
            issueId: ticket.key,
            url: ticketUrl,
            displayName: `${ticket.key}: ${args.summary}`,
          });
          linkingResults.push('✅ Linked Jira ticket to Sentry issue');
          
          // Also add a note to the Sentry issue
          await this.sentryService.addIssueNote(
            args.sentry_issue_id,
            `Jira ticket created: [${ticket.key}](${ticketUrl})`
          );
          linkingResults.push('✅ Added note to Sentry issue');
        } catch (linkError) {
          linkingResults.push(`⚠️ Created Jira ticket but failed to link to Sentry: ${linkError instanceof Error ? linkError.message : String(linkError)}`);
        }
      }

      const linkingText = linkingResults.length > 0 
        ? `\n\n**Integration Results:**\n${linkingResults.map(result => `- ${result}`).join('\n')}`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: `## ✅ Jira Ticket Created Successfully\n\n` +
                  `**Ticket:** [${ticket.key}](${ticketUrl})\n` +
                  `**Summary:** ${args.summary}\n` +
                  `**URL:** ${ticketUrl}\n\n` +
                  `The ticket has been created and is ready for development.${linkingText}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating Jira ticket: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async getIssueTypes(args: { project_key: string }) {
    if (!this.jiraService.isConfigured()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Jira is not configured. Please set JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.',
          },
        ],
      };
    }

    try {
      const issueTypes = await this.jiraService.getProjectIssueTypes(args.project_key);
      
      if (issueTypes.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No issue types found for project ${args.project_key}.`,
            },
          ],
        };
      }

      const typeList = issueTypes.map((type, index) => {
        return `${index + 1}. **${type.name}**\n` +
               `   ID: ${type.id}\n` +
               `   Subtask: ${type.subtask ? 'Yes' : 'No'}\n`;
      }).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `## 🎯 Available Issue Types for ${args.project_key} (${issueTypes.length} found)\n\n${typeList}\n\n` +
                  `💡 Use the issue type ID with \`create_jira_ticket\` to specify the ticket type.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching issue types: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async createJiraFromSentry(args: {
    sentry_issue_id: string;
    board_id: number;
    issue_type: string;
    priority?: string;
    custom_summary?: string;
    additional_description?: string;
    labels?: string[];
  }) {
    if (!this.sentryService.isConfigured()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Sentry is not configured. Please set SENTRY_AUTH_TOKEN and SENTRY_ORGANIZATION environment variables.',
          },
        ],
      };
    }

    if (!this.jiraService.isConfigured()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Jira is not configured. Please set JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.',
          },
        ],
      };
    }

    try {
      // Fetch Sentry issue details
      const issue = await this.sentryService.getIssueDetails(args.sentry_issue_id);
      const latestEvent = await this.sentryService.getLatestEvent(args.sentry_issue_id);
      const stackTrace = this.sentryService.extractStackTrace(latestEvent);

      // Build ticket summary and description
      const summary = args.custom_summary || issue.title;
      
      let description = `**Sentry Issue Details**\n\n`;
      description += `- **Issue ID:** ${issue.id}\n`;
      description += `- **Status:** ${issue.status}\n`;
      description += `- **Level:** ${issue.level}\n`;
      description += `- **Count:** ${issue.count} occurrences\n`;
      description += `- **First Seen:** ${new Date(issue.firstSeen).toLocaleString()}\n`;
      description += `- **Last Seen:** ${new Date(issue.lastSeen).toLocaleString()}\n`;
      description += `- **Environment:** ${latestEvent.environment || 'Not specified'}\n`;
      description += `- **Release:** ${latestEvent.release || 'Not specified'}\n\n`;
      
      if (issue.metadata.type && issue.metadata.value) {
        description += `**Error:** ${issue.metadata.type}: ${issue.metadata.value}\n\n`;
      }

      if (stackTrace) {
        description += `**Stack Trace:**\n\`\`\`\n${stackTrace}\n\`\`\`\n\n`;
      }

      if (latestEvent.request?.url) {
        description += `**Request URL:** ${latestEvent.request.url}\n`;
        if (latestEvent.request.method) {
          description += `**Request Method:** ${latestEvent.request.method}\n`;
        }
        description += '\n';
      }

      if (latestEvent.user) {
        description += `**User Information:**\n`;
        if (latestEvent.user.id) description += `- ID: ${latestEvent.user.id}\n`;
        if (latestEvent.user.email) description += `- Email: ${latestEvent.user.email}\n`;
        if (latestEvent.user.username) description += `- Username: ${latestEvent.user.username}\n`;
        description += '\n';
      }

      if (args.additional_description) {
        description += `**Additional Notes:**\n${args.additional_description}\n\n`;
      }

      description += `**Sentry Link:** ${issue.permalink}`;

      // Prepare labels
      const labels = [...(args.labels || []), 'sentry', 'bug'];
      if (issue.level) {
        labels.push(`sentry-${issue.level}`);
      }
      if (latestEvent.environment) {
        labels.push(`env-${latestEvent.environment}`);
      }

      // Create Jira ticket
      const ticket = await this.jiraService.createTicket({
        boardId: args.board_id,
        summary,
        description,
        issueType: args.issue_type,
        priority: args.priority,
        labels,
        sentryIssueUrl: issue.permalink,
      });

      const ticketUrl = this.jiraService.getTicketUrl(ticket.key);
      let linkingResults: string[] = [];

      // Link back to Sentry
      try {
        await this.sentryService.linkExternalIssue(args.sentry_issue_id, {
          issueId: ticket.key,
          url: ticketUrl,
          displayName: `${ticket.key}: ${summary}`,
        });
        linkingResults.push('✅ Linked Jira ticket to Sentry issue');
        
        // Add a note to the Sentry issue
        await this.sentryService.addIssueNote(
          args.sentry_issue_id,
          `Jira ticket created: [${ticket.key}](${ticketUrl})\n\nThis issue has been escalated to the development team for resolution.`
        );
        linkingResults.push('✅ Added note to Sentry issue');
      } catch (linkError) {
        linkingResults.push(`⚠️ Created Jira ticket but failed to link to Sentry: ${linkError instanceof Error ? linkError.message : String(linkError)}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: `## ✅ Jira Ticket Created from Sentry Issue\n\n` +
                  `**Sentry Issue:** ${issue.shortId} - ${issue.title}\n` +
                  `**Jira Ticket:** [${ticket.key}](${ticketUrl})\n` +
                  `**Summary:** ${summary}\n` +
                  `**Occurrences:** ${issue.count}\n` +
                  `**Level:** ${issue.level}\n\n` +
                  `**Integration Results:**\n${linkingResults.map(result => `- ${result}`).join('\n')}\n\n` +
                  `The ticket contains detailed error information, stack trace, and user context from Sentry.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating Jira ticket from Sentry issue: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Sentry Investigator MCP server running on stdio');
  }
}

const server = new SentryInvestigatorServer();
server.run().catch(console.error); 
