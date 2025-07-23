# Sentry Investigator MCP (Ruby-Focused)

A Model Context Protocol (MCP) server that automatically reads Sentry issues, investigates them by analyzing your Ruby codebase, explains why issues happened, and provides fix suggestions tailored for Ruby applications.

## 🚀 Features

- **🔍 Sentry Integration**: Fetch and analyze issues directly from your Sentry projects
- **💎 Ruby-Focused Analysis**: Specialized support for Ruby, Rails, and ERB files
- **📊 Codebase Analysis**: Automatically analyze your Ruby code to understand issue context
- **🧠 Smart Investigation**: Combine Sentry data with Ruby code analysis for comprehensive insights
- **🔧 Ruby Fix Suggestions**: Get specific, actionable fix recommendations for Ruby errors
- **📈 Impact Analysis**: Understand user impact and frequency patterns
- **⚡ Stack Trace Analysis**: Deep dive into Ruby stack traces with code context

## 📋 Prerequisites

- Node.js 18 or higher
- A Sentry account with API access
- Ruby/Rails project (primary focus)
- Cursor editor (or any MCP-compatible client)

## ⚙️ Installation

1. Clone or download this MCP server:
```bash
git clone https://github.com/doraemon0905/sentry-mcp
cd sentry-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## 🔧 Setup

### 1. Get Sentry API Token

1. Go to Sentry (https://your_domain.sentry.io) → Settings → Personal Tokens
2. Create a new token with the following scopes:
   - `org:read`
   - `project:read` 
   - `event:read`
   - `alerts:read`
   - `team:read`

### 2. Configure Cursor

Add the MCP server to your Cursor configuration. Edit your MCP settings file:

**On macOS/Linux:** `~/.cursor/mcp.json`  
**On Windows:** `%APPDATA%\Cursor\mcp.json`

```json
{
  "mcpServers": {
    "sentry-investigator": {
      "command": "node",
      "args": ["/path/to/sentry-mcp/dist/index.js"],
      "env": {
        "SENTRY_AUTH_TOKEN": "your-sentry-auth-token-here",
        "SENTRY_ORGANIZATION": "your-sentry-org-slug",
        "SENTRY_PROJECT": "your-default-project-slug"
      }
    }
  }
}
```

**Required Environment Variables:**
- `SENTRY_AUTH_TOKEN`: Your Sentry API token
- `SENTRY_ORGANIZATION`: Your Sentry organization slug
- `SENTRY_PROJECT`: (Optional) Your default project slug

Replace `/path/to/sentry-mcp` with the actual path to this project.

### 3. Restart Cursor

Restart Cursor to load the new MCP server.

## 🎯 Usage

### 1. List Recent Issues

```
Use the get_sentry_issues tool to fetch recent issues:
- project: (optional) Specific project slug
- limit: Number of issues (default: 10, max: 100)
- status: unresolved, resolved, or ignored (default: unresolved)
```

### 2. Investigate an Issue

```
Use the investigate_issue tool with:
- issue_id: The Sentry issue ID
- codebase_path: Path to your Ruby codebase (default: current directory)
- include_fix: Whether to include fix suggestions (default: true)
```

### 3. Analyze Stack Traces

```
Use the analyze_stack_trace tool to analyze any Ruby stack trace:
- stack_trace: The stack trace text
- codebase_path: Path to your Ruby codebase (default: current directory)
```

## 🔧 Available Tools

| Tool | Description |
|------|-------------|
| `get_sentry_issues` | Fetch recent issues from Sentry |
| `investigate_issue` | Full investigation of a specific issue (supports short IDs like "ATS-3YJ") |
| `analyze_stack_trace` | Analyze any stack trace with Ruby code context |

## 📝 Example Investigation Report

When you investigate a Ruby issue, you'll get a comprehensive report including:

```markdown
# 🐛 Issue Investigation Report

**Issue:** NoMethodError: undefined method `name' for nil:NilClass
**ID:** 12345 (PROJ-1AB)
**Status:** unresolved
**Level:** error
**Occurrences:** 45 (12 users affected)
**First Seen:** 2024-01-15 10:30:00
**Last Seen:** 2024-01-20 15:45:00

## 🔍 Stack Trace Analysis

**Parsed Stack Trace:**
1. `get_user_data`
   📁 app/services/user_service.rb:25

### 📄 `app/services/user_service.rb` (Line 25)

```ruby
  23: def get_user_data(user_id)
  24:   user = User.find_by(id: user_id)
→ 25:   user.name # Error occurs here
  26: end
```

🔧 **Function:** `get_user_data`

## 💡 Issue Analysis

**Error Type:** `NoMethodError`
Ruby error caused by trying to call a method on a nil object.

**Frequency Analysis:** Medium frequency (9 occurrences/day)
**Impact Level:** 🟡 Medium (12 users affected)

## 🔧 Suggested Fixes

### NoMethodError Fix
```ruby
# Add method existence checks
if user.respond_to?(:name)
  user.name
else
  # Handle missing method case
end

# Or use safe navigation
user&.name
```

## 🛠️ Development

### Project Structure

```
src/
├── index.ts              # Main MCP server entry point
├── services/
│   ├── SentryService.ts      # Sentry API integration
│   ├── CodebaseAnalyzer.ts   # Ruby-focused code analysis utilities  
│   └── IssueInvestigator.ts  # Main investigation logic
```

### Ruby Language Support

The MCP is optimized for Ruby applications and includes:

- **File Types**: `.rb`, `.erb`, `.rake` files
- **Stack Trace Parsing**: Ruby-specific error format recognition
- **Method Detection**: Ruby method definitions (`def`, `self.`, lambdas, procs)
- **Import Analysis**: `require`, `require_relative`, `include`, `extend`, `gem` statements
- **Error Types**: `NoMethodError`, `NameError`, `ArgumentError`, `TypeError`, etc.
- **Fix Suggestions**: Ruby-specific error handling patterns

### Scripts

- `npm run build` - Build the TypeScript project
- `npm run dev` - Build in watch mode for development
- `npm start` - Run the built server

### Building from Source

```bash
npm install
npm run build
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Troubleshooting

### Common Issues

**"Sentry service not configured"**
- Ensure `SENTRY_AUTH_TOKEN` and `SENTRY_ORGANIZATION` environment variables are set in your MCP configuration
- Verify your API token has the correct permissions

**"No project specified and no default project configured"**
- Either specify a project in the tool call or set `SENTRY_PROJECT` environment variable

**"Failed to connect to Sentry"**
- Check your API token and organization slug
- Ensure your network allows HTTPS requests to sentry.io

**"File not found in codebase"**
- Verify the codebase_path parameter points to your Ruby project root
- Some files in stack traces may be from gems or external libraries

### Ruby-Specific Notes

- The analyzer prioritizes Ruby files (`.rb`, `.erb`, `.rake`) over other file types
- Stack trace parsing is optimized for Ruby error formats
- Method suggestions focus on Ruby patterns and best practices
- Excludes common Ruby directories (`vendor/`, `tmp/`) from analysis

## 🔗 Links

- [Sentry API Documentation](https://docs.sentry.io/api/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Cursor Documentation](https://cursor.sh/docs)
- [Ruby Documentation](https://ruby-doc.org/)
- [Rails Guides](https://guides.rubyonrails.org/) 
