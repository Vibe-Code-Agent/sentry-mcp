import { SentryService, SentryIssue, SentryEvent } from './SentryService.js';
import { CodebaseAnalyzer } from './CodebaseAnalyzer.js';

export class IssueInvestigator {
  constructor(
    private sentryService: SentryService,
    private codebaseAnalyzer: CodebaseAnalyzer
  ) {}

  async investigate(issueId: string, codebasePath: string, includeFix: boolean = true): Promise<string> {
    try {
      // Get issue details and latest event
      const [issue, latestEvent] = await Promise.all([
        this.sentryService.getIssueDetails(issueId),
        this.sentryService.getLatestEvent(issueId)
      ]);

      let investigation = this.formatIssueHeader(issue);
      
      // Analyze the stack trace if available
      const stackTrace = this.sentryService.extractStackTrace(latestEvent);
      if (stackTrace) {
        investigation += "\n## 🔍 Stack Trace Analysis\n\n";
        investigation += await this.codebaseAnalyzer.analyzeStackTrace(stackTrace, codebasePath);
      }

      // Analyze relevant files
      const relevantFiles = this.sentryService.extractRelevantFiles(latestEvent);
      if (relevantFiles.length > 0) {
        investigation += "\n## 📁 Relevant Files Analysis\n\n";
        investigation += await this.analyzeRelevantFiles(relevantFiles, codebasePath);
      }

      // Provide context and explanation
      investigation += "\n## 💡 Issue Analysis\n\n";
      investigation += this.generateIssueExplanation(issue, latestEvent);

      // Suggest fixes if requested
      if (includeFix) {
        investigation += "\n## 🔧 Suggested Fixes\n\n";
        investigation += this.generateFixSuggestions(issue, latestEvent, stackTrace);
      }

      return investigation;
    } catch (error) {
      return `❌ **Error investigating issue**: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private formatIssueHeader(issue: SentryIssue): string {
    return `# 🐛 Issue Investigation Report\n\n` +
           `**Issue:** ${issue.title}\n` +
           `**ID:** ${issue.id} (${issue.shortId})\n` +
           `**Status:** ${issue.status}\n` +
           `**Level:** ${issue.level}\n` +
           `**Occurrences:** ${issue.count} (${issue.userCount} users affected)\n` +
           `**First Seen:** ${new Date(issue.firstSeen).toLocaleString()}\n` +
           `**Last Seen:** ${new Date(issue.lastSeen).toLocaleString()}\n` +
           `**Project:** ${issue.project.name}\n` +
           `**URL:** [View in Sentry](${issue.permalink})\n`;
  }

  private async analyzeRelevantFiles(files: string[], codebasePath: string): Promise<string> {
    let analysis = "";

    for (const file of files.slice(0, 5)) { // Limit to 5 files
      try {
        const fileAnalysis = await this.codebaseAnalyzer.analyzeFile(`${codebasePath}/${file}`);
        if (fileAnalysis) {
          analysis += `### 📄 \`${file}\`\n\n`;
          analysis += `- **Lines:** ${fileAnalysis.lineCount}\n`;
          if (fileAnalysis.functions.length > 0) {
            analysis += `- **Functions:** ${fileAnalysis.functions.slice(0, 10).join(', ')}${fileAnalysis.functions.length > 10 ? '...' : ''}\n`;
          }
          if (fileAnalysis.imports.length > 0) {
            analysis += `- **Key Imports:** ${fileAnalysis.imports.slice(0, 5).join(', ')}${fileAnalysis.imports.length > 5 ? '...' : ''}\n`;
          }
          analysis += "\n";
        }
      } catch (error) {
        analysis += `### ❓ \`${file}\`\n\n*File not found in codebase - may be from external library*\n\n`;
      }
    }

    return analysis || "*No relevant files found in the current codebase.*\n";
  }

  private generateIssueExplanation(issue: SentryIssue, event: SentryEvent): string {
    let explanation = "";

    // Error type analysis
    if (issue.metadata.type) {
      explanation += `**Error Type:** \`${issue.metadata.type}\`\n`;
      explanation += this.getErrorTypeExplanation(issue.metadata.type) + "\n\n";
    }

    // Frequency analysis
    const frequency = this.analyzeFrequency(issue);
    explanation += `**Frequency Analysis:** ${frequency}\n\n`;

    // Environment analysis
    if (event.environment) {
      explanation += `**Environment:** ${event.environment}\n`;
    }

    // User impact analysis
    if (issue.userCount > 0) {
      const impactLevel = this.calculateImpactLevel(issue.count, issue.userCount);
      explanation += `**Impact Level:** ${impactLevel}\n\n`;
    }

    // Tags analysis
    if (event.tags && event.tags.length > 0) {
      explanation += `**Additional Context:**\n`;
      event.tags.forEach(tag => {
        explanation += `- ${tag.key}: ${tag.value}\n`;
      });
      explanation += "\n";
    }

    return explanation;
  }

  private generateFixSuggestions(issue: SentryIssue, event: SentryEvent, stackTrace: string | null): string {
    let suggestions = "";

    if (issue.metadata.type) {
      suggestions += this.getErrorTypeFixSuggestions(issue.metadata.type, issue.metadata.value);
    }

    // Ruby-focused suggestions based on common patterns
    if (stackTrace) {
      if (stackTrace.includes('NoMethodError') || stackTrace.includes('undefined method')) {
        suggestions += "### NoMethodError Fix\n";
        suggestions += "```ruby\n";
        suggestions += "# Add method existence checks\n";
        suggestions += "if object.respond_to?(:method_name)\n";
        suggestions += "  object.method_name\n";
        suggestions += "else\n";
        suggestions += "  # Handle missing method case\n";
        suggestions += "end\n\n";
        suggestions += "# Or use safe navigation\n";
        suggestions += "object&.method_name\n";
        suggestions += "```\n\n";
      }

      if (stackTrace.includes('NameError') || stackTrace.includes('uninitialized constant')) {
        suggestions += "### NameError/Uninitialized Constant Fix\n";
        suggestions += "```ruby\n";
        suggestions += "# Ensure proper require statements\n";
        suggestions += "require 'module_name'\n\n";
        suggestions += "# Or check if constant is defined\n";
        suggestions += "if defined?(ConstantName)\n";
        suggestions += "  # Use the constant\n";
        suggestions += "else\n";
        suggestions += "  # Handle missing constant\n";
        suggestions += "end\n";
        suggestions += "```\n\n";
      }

      if (stackTrace.includes('ArgumentError') || stackTrace.includes('wrong number of arguments')) {
        suggestions += "### ArgumentError Fix\n";
        suggestions += "```ruby\n";
        suggestions += "# Check method signature and arguments\n";
        suggestions += "def method_name(*args, **kwargs)\n";
        suggestions += "  # Handle variable arguments\n";
        suggestions += "end\n\n";
        suggestions += "# Or validate arguments\n";
        suggestions += "raise ArgumentError, 'Expected 2 arguments' unless args.length == 2\n";
        suggestions += "```\n\n";
      }

      if (stackTrace.includes('nil') || stackTrace.includes('NilClass')) {
        suggestions += "### Null/Nil Check\n";
        suggestions += "```ruby\n";
        suggestions += "# Add nil checks before accessing methods/properties\n";
        suggestions += "if variable.nil?\n";
        suggestions += "  # Handle nil case\n";
        suggestions += "else\n";
        suggestions += "  variable.some_method\n";
        suggestions += "end\n\n";
        suggestions += "# Or use safe navigation\n";
        suggestions += "variable&.some_method\n\n";
        suggestions += "# Or use presence check\n";
        suggestions += "variable.present? && variable.some_method\n";
        suggestions += "```\n\n";
      }

      if (stackTrace.includes('TypeError') || stackTrace.includes('String') || stackTrace.includes('Integer')) {
        suggestions += "### Type Conversion Error Fix\n";
        suggestions += "```ruby\n";
        suggestions += "# Safe type conversion\n";
        suggestions += "begin\n";
        suggestions += "  result = value.to_i\n";
        suggestions += "rescue ArgumentError, TypeError\n";
        suggestions += "  # Handle conversion error\n";
        suggestions += "  result = 0 # or appropriate default\n";
        suggestions += "end\n\n";
        suggestions += "# Or validate before conversion\n";
        suggestions += "if value.is_a?(String) && value.match?(/\\A\\d+\\z/)\n";
        suggestions += "  result = value.to_i\n";
        suggestions += "end\n";
        suggestions += "```\n\n";
      }
    }

    // Add Ruby-specific error monitoring
    suggestions += "### Add Error Context (Ruby/Rails)\n";
    suggestions += "```ruby\n";
    suggestions += "# For Rails, you can also use:\n";
    suggestions += "Rails.logger.error 'Detailed error context' if Rails.env.production?\n";
    suggestions += "```\n\n";

    return suggestions || "*No specific fix suggestions available. Consider reviewing the stack trace and adding appropriate error handling.*\n";
  }

  private getErrorTypeExplanation(errorType: string): string {
    const explanations: Record<string, string> = {
      'TypeError': 'Type-related error, often caused by trying to use a value as a different type than expected (e.g., calling a method on null/undefined).',
      'ReferenceError': 'Variable or function reference error, typically when trying to access a variable that is not defined.',
      'SyntaxError': 'Code syntax error, usually caught during parsing/compilation.',
      'RangeError': 'Value out of range error, often with arrays or numeric operations.',
      'URIError': 'URI-related error, typically in URL encoding/decoding operations.',
      'EvalError': 'Error in eval() function usage.',
      'Error': 'Generic error, often custom application errors.',
    };

    return explanations[errorType] || 'Application-specific error that requires code review to understand the root cause.';
  }

  private getErrorTypeFixSuggestions(errorType: string, errorValue?: string): string {
    const suggestions: Record<string, string> = {
      'NoMethodError': `### NoMethodError Fix Suggestions\n` +
                       `- Check if the method exists using \`respond_to?\`\n` +
                       `- Use safe navigation operator (\`&.\`)\n` +
                       `- Verify the object type before calling methods\n` +
                       `- Check for typos in method names\n\n`,
      
      'NameError': `### NameError Fix Suggestions\n` +
                   `- Ensure proper \`require\` or \`require_relative\` statements\n` +
                   `- Check constant names for typos\n` +
                   `- Verify module/class definitions are loaded\n` +
                   `- Use \`defined?(ConstantName)\` to check if constant exists\n\n`,
      
      'ArgumentError': `### ArgumentError Fix Suggestions\n` +
                       `- Check method signatures and expected parameters\n` +
                       `- Use splat operators (*args, **kwargs) for flexible parameters\n` +
                       `- Validate arguments before method calls\n` +
                       `- Review method documentation for correct usage\n\n`,
      
      'TypeError': `### TypeError Fix Suggestions\n` +
                   `- Add type checking before operations (\`is_a?\`, \`kind_of?\`)\n` +
                   `- Use safe type conversion methods (\`to_s\`, \`to_i\`, \`to_f\`)\n` +
                   `- Handle type conversion errors with begin/rescue blocks\n` +
                   `- Validate input types in method parameters\n\n`,
      
      'ReferenceError': `### ReferenceError Fix Suggestions\n` +
                        `- Check variable declarations and scope\n` +
                        `- Ensure imports are correct\n` +
                        `- Verify variable names for typos\n` +
                        `- Check if variables are defined before use\n\n`,
      
      'RangeError': `### RangeError Fix Suggestions\n` +
                    `- Validate array indices before access\n` +
                    `- Check numeric ranges in calculations\n` +
                    `- Add bounds checking for user inputs\n\n`,
    };

    return suggestions[errorType] || '';
  }

  private analyzeFrequency(issue: SentryIssue): string {
    const now = new Date();
    const firstSeen = new Date(issue.firstSeen);
    const daysSinceFirst = Math.floor((now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysSinceFirst === 0) return "New issue (first seen today)";
    
    const avgPerDay = Math.round(issue.count / daysSinceFirst);
    
    if (avgPerDay >= 10) return `High frequency (${avgPerDay} occurrences/day)`;
    if (avgPerDay >= 1) return `Medium frequency (${avgPerDay} occurrences/day)`;
    return `Low frequency (${issue.count} total over ${daysSinceFirst} days)`;
  }

  private calculateImpactLevel(count: number, userCount: number): string {
    const ratio = userCount / count;
    
    if (userCount >= 100) return "🔴 High (100+ users affected)";
    if (userCount >= 10) return "🟡 Medium (10+ users affected)";
    if (ratio > 0.8) return "🟡 Medium (affects most sessions)";
    return "🟢 Low (limited user impact)";
  }
} 