import axios, { AxiosInstance } from 'axios';
import https from 'https';

export interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  permalink: string;
  shortId: string;
  status: string;
  level: string;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  tags: Array<{ key: string; value: string }>;
  project: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface SentryEvent {
  id: string;
  message: string;
  timestamp: string;
  platform: string;
  environment?: string;
  release?: string;
  tags: Array<{ key: string; value: string }>;
  user?: {
    id?: string;
    email?: string;
    username?: string;
  };
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: {
        frames: Array<{
          filename: string;
          function: string;
          lineno: number;
          colno?: number;
          context_line?: string;
          pre_context?: string[];
          post_context?: string[];
          in_app: boolean;
        }>;
      };
    }>;
  };
  breadcrumbs?: Array<{
    timestamp: string;
    type: string;
    category: string;
    message: string;
    level: string;
  }>;
}



export class SentryService {
  private client: AxiosInstance | null = null;
  private organization: string | null = null;
  private defaultProject: string | null = null;

  constructor() {
    // Auto-configure from environment variables on startup
    this.configureFromEnv();
  }

  private configureFromEnv(): void {
    const authToken = process.env.SENTRY_AUTH_TOKEN;
    const organization = process.env.SENTRY_ORGANIZATION;
    const project = process.env.SENTRY_PROJECT;

    if (authToken && organization) {
      this.organization = organization;
      this.defaultProject = project || null;

      // Create HTTPS agent that accepts self-signed certificates (common in corporate environments)
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });

      this.client = axios.create({
        baseURL: 'https://sentry.io/api/0',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        httpsAgent: httpsAgent,
      });

      console.error(`✅ Sentry configured from environment variables for organization: ${organization}${project ? `, project: ${project}` : ''}`);
    } else {
      console.error('❌ Missing required environment variables: SENTRY_AUTH_TOKEN and SENTRY_ORGANIZATION must be set');
    }
  }

  isConfigured(): boolean {
    return this.client !== null && this.organization !== null;
  }

  async getIssues(options: {
    project?: string;
    limit?: number;
    status?: 'unresolved' | 'resolved' | 'ignored';
  } = {}): Promise<SentryIssue[]> {
    if (!this.isConfigured()) {
      throw new Error('Sentry service not configured. Please ensure SENTRY_AUTH_TOKEN and SENTRY_ORGANIZATION environment variables are set.');
    }

    const project = options.project || this.defaultProject;
    if (!project) {
      throw new Error('No project specified and no default project configured. Please provide a project parameter or set SENTRY_PROJECT environment variable.');
    }

    const params = new URLSearchParams({
      limit: String(Math.min(options.limit || 10, 100)),
      query: `is:${options.status || 'unresolved'}`,
      sort: 'date',
    });

    try {
      const response = await this.client!.get(
        `/projects/${this.organization}/${project}/issues/?${params}`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch Sentry issues: ${error}`);
    }
  }

  async getIssueDetails(issueId: string): Promise<SentryIssue> {
    if (!this.isConfigured()) {
      throw new Error('Sentry service not configured. Please ensure SENTRY_AUTH_TOKEN and SENTRY_ORGANIZATION environment variables are set.');
    }

    try {
      // Check if this looks like a short ID (format: PROJECT-ABC)
      if (this.isShortId(issueId)) {
        const fullIssueId = await this.resolveShortId(issueId);
        const response = await this.client!.get(`/issues/${fullIssueId}/`);
        return response.data;
      } else {
        const response = await this.client!.get(`/issues/${issueId}/`);
        return response.data;
      }
    } catch (error) {
      throw new Error(`Failed to fetch issue details: ${error}`);
    }
  }

  private isShortId(id: string): boolean {
    // Short IDs typically follow the pattern: PROJECT-ABC (letters/numbers, dash, alphanumeric)
    return /^[A-Z0-9-]+-[A-Z0-9]+$/i.test(id);
  }

  async resolveShortId(shortId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Sentry service not configured. Please ensure SENTRY_AUTH_TOKEN and SENTRY_ORGANIZATION environment variables are set.');
    }

    try {
      // Strategy: Search across projects without query parameters (which cause 400 errors)
      // and filter results manually for the short ID
      const projects = await this.client!.get(`/organizations/${this.organization}/projects/`);
      
      for (const project of projects.data) {
        try {
          // Get recent issues from each project without query filters
          const projectIssuesResponse = await this.client!.get(
            `/projects/${this.organization}/${project.slug}/issues/?limit=100`
          );
          
          if (projectIssuesResponse.data && projectIssuesResponse.data.length > 0) {
            // Look for exact short ID match
            const match = projectIssuesResponse.data.find((issue: SentryIssue) => 
              issue.shortId === shortId
            );
            
            if (match) {
              return match.id;
            }
          }
        } catch (projectError) {
          // Continue searching other projects if one fails
          continue;
        }
      }

      throw new Error(`Issue with short ID "${shortId}" not found. Please check the ID and try again.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to resolve short ID "${shortId}": ${error}`);
    }
  }

  async getIssueEvents(issueId: string, limit: number = 10): Promise<SentryEvent[]> {
    if (!this.isConfigured()) {
      throw new Error('Sentry service not configured. Please ensure SENTRY_AUTH_TOKEN and SENTRY_ORGANIZATION environment variables are set.');
    }

    try {
      // Resolve short ID if needed
      const resolvedIssueId = this.isShortId(issueId) ? await this.resolveShortId(issueId) : issueId;
      const response = await this.client!.get(
        `/issues/${resolvedIssueId}/events/?limit=${limit}`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch issue events: ${error}`);
    }
  }

  async getLatestEvent(issueId: string): Promise<SentryEvent> {
    if (!this.isConfigured()) {
      throw new Error('Sentry service not configured. Please ensure SENTRY_AUTH_TOKEN and SENTRY_ORGANIZATION environment variables are set.');
    }

    try {
      // Resolve short ID if needed
      const resolvedIssueId = this.isShortId(issueId) ? await this.resolveShortId(issueId) : issueId;
      const response = await this.client!.get(`/issues/${resolvedIssueId}/events/latest/`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch latest event: ${error}`);
    }
  }

  extractStackTrace(event: SentryEvent): string | null {
    if (!event.exception?.values?.length) {
      return null;
    }

    const exception = event.exception.values[0];
    if (!exception.stacktrace?.frames?.length) {
      return null;
    }

    const frames = exception.stacktrace.frames.reverse(); // Most recent frame first
    const stackLines = frames.map(frame => {
      const location = `${frame.filename}:${frame.lineno}${frame.colno ? `:${frame.colno}` : ''}`;
      return `  at ${frame.function || '<anonymous>'} (${location})`;
    });

    return `${exception.type}: ${exception.value}\n${stackLines.join('\n')}`;
  }

  extractRelevantFiles(event: SentryEvent): string[] {
    const files = new Set<string>();

    if (event.exception?.values?.length) {
      for (const exception of event.exception.values) {
        if (exception.stacktrace?.frames?.length) {
          for (const frame of exception.stacktrace.frames) {
            if (frame.in_app && frame.filename) {
              // Normalize the filename - remove leading slashes and resolve relative paths
              let filename = frame.filename;
              if (filename.startsWith('/')) {
                filename = filename.substring(1);
              }
              if (filename.startsWith('./')) {
                filename = filename.substring(2);
              }
              files.add(filename);
            }
          }
        }
      }
    }

    return Array.from(files);
  }
} 