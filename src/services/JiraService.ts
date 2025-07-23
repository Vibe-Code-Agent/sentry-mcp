import axios, { AxiosInstance } from 'axios';
import https from 'https';

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  location: {
    projectId: number;
    projectKey: string;
    projectName: string;
  };
}

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
  iconUrl: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
}

export interface CreateJiraTicketRequest {
  boardId: number;
  summary: string;
  description: string;
  issueType: string;
  priority?: string;
  labels?: string[];
  sentryIssueUrl?: string;
}

export interface JiraTicket {
  id: string;
  key: string;
  self: string;
}

export class JiraService {
  private client: AxiosInstance | null = null;
  private baseUrl: string | null = null;

  constructor() {
    this.configureFromEnv();
  }

  private configureFromEnv(): void {
    const jiraUrl = process.env.JIRA_URL;
    const jiraEmail = process.env.JIRA_EMAIL;
    const jiraApiToken = process.env.JIRA_API_TOKEN;

    if (jiraUrl && jiraEmail && jiraApiToken) {
      this.baseUrl = jiraUrl.endsWith('/') ? jiraUrl.slice(0, -1) : jiraUrl;
      
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });

      this.client = axios.create({
        baseURL: this.baseUrl,
        headers: {
          'Authorization': `Basic ${Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64')}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 30000,
        httpsAgent: httpsAgent,
      });

      console.error(`✅ Jira configured for: ${this.baseUrl}`);
    } else {
      console.error('❌ Missing required environment variables: JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN must be set');
    }
  }

  isConfigured(): boolean {
    return this.client !== null && this.baseUrl !== null;
  }

  async getBoards(): Promise<JiraBoard[]> {
    if (!this.isConfigured()) {
      throw new Error('Jira service not configured. Please ensure JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables are set.');
    }

    try {
      // Use the correct agile API endpoint for boards
      const response = await this.client!.get('/rest/agile/1.0/board');
      return response.data.values || [];
    } catch (error) {
      throw new Error(`Failed to fetch Jira boards: ${error}`);
    }
  }

  async getBoardById(boardId: number): Promise<JiraBoard> {
    if (!this.isConfigured()) {
      throw new Error('Jira service not configured. Please ensure JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables are set.');
    }

    try {
      const response = await this.client!.get(`/rest/agile/1.0/board/${boardId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch board ${boardId}: ${error}`);
    }
  }

  async getProjectIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
    if (!this.isConfigured()) {
      throw new Error('Jira service not configured. Please ensure JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables are set.');
    }

    try {
      const response = await this.client!.get(`/rest/api/3/project/${projectKey}/statuses`);
      const issueTypes = new Set<string>();
      const result: JiraIssueType[] = [];

      for (const status of response.data) {
        if (!issueTypes.has(status.issueType.id)) {
          issueTypes.add(status.issueType.id);
          result.push({
            id: status.issueType.id,
            name: status.issueType.name,
            subtask: status.issueType.subtask,
            iconUrl: status.issueType.iconUrl,
          });
        }
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to fetch issue types for project ${projectKey}: ${error}`);
    }
  }

  async createTicket(request: CreateJiraTicketRequest): Promise<JiraTicket> {
    if (!this.isConfigured()) {
      throw new Error('Jira service not configured. Please ensure JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables are set.');
    }

    try {
      // Get board details to extract project information
      const board = await this.getBoardById(request.boardId);
      const projectKey = board.location.projectKey;

      // Build description with Sentry link if provided
      let description = request.description;
      if (request.sentryIssueUrl) {
        description += `\n\n*Sentry Issue:* ${request.sentryIssueUrl}`;
      }

      const issueData = {
        fields: {
          project: {
            key: projectKey,
          },
          summary: request.summary,
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: description,
                  },
                ],
              },
            ],
          },
          issuetype: {
            id: request.issueType,
          },
          priority: request.priority ? {
            name: request.priority,
          } : undefined,
          labels: request.labels || [],
        },
      };

      // Remove undefined fields
      if (!issueData.fields.priority) {
        delete issueData.fields.priority;
      }

      const response = await this.client!.post('/rest/api/3/issue', issueData);
      
      return {
        id: response.data.id,
        key: response.data.key,
        self: response.data.self,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const errorData = error.response.data;
        throw new Error(`Failed to create Jira ticket: ${JSON.stringify(errorData)}`);
      }
      throw new Error(`Failed to create Jira ticket: ${error}`);
    }
  }

  getTicketUrl(ticketKey: string): string {
    if (!this.baseUrl) {
      throw new Error('Jira service not configured');
    }
    return `${this.baseUrl}/browse/${ticketKey}`;
  }
}