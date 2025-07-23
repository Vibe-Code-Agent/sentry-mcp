import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';

export interface FileAnalysis {
  path: string;
  content: string;
  lineCount: number;
  functions: string[];
  imports: string[];
  relevantLines?: Array<{
    lineNumber: number;
    content: string;
    context: 'before' | 'target' | 'after';
  }>;
}

export interface StackTraceFrame {
  filename: string;
  function: string;
  line: number;
  column?: number;
}

export class CodebaseAnalyzer {
  private gitignorePatterns: ReturnType<typeof ignore> | null = null;

  async analyzeCodebase(codebasePath: string): Promise<FileAnalysis[]> {
    await this.loadGitignore(codebasePath);
    
    const patterns = [
      '**/*.{rb,erb,rake}', // Focus on Ruby files first
      '**/*.{ts,tsx,js,jsx,py,java,go,php,cs,cpp,c,h}', // Other languages as secondary
      '!node_modules/**',
      '!dist/**',
      '!build/**',
      '!.git/**',
      '!vendor/**', // Ruby vendor directory
      '!tmp/**', // Ruby tmp directory
    ];

    const files = await glob(patterns, { cwd: codebasePath });
    const filteredFiles = this.filterIgnoredFiles(files);
    
    const analyses: FileAnalysis[] = [];
    for (const file of filteredFiles.slice(0, 50)) { // Limit to avoid overwhelming
      try {
        const analysis = await this.analyzeFile(path.join(codebasePath, file));
        if (analysis) {
          analyses.push(analysis);
        }
      } catch (error) {
        console.error(`Error analyzing file ${file}:`, error);
      }
    }

    return analyses;
  }

  async analyzeFile(filePath: string): Promise<FileAnalysis | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      return {
        path: filePath,
        content,
        lineCount: lines.length,
        functions: this.extractFunctions(content),
        imports: this.extractImports(content),
      };
    } catch (error) {
      return null;
    }
  }

  async analyzeStackTrace(stackTrace: string, codebasePath: string): Promise<string> {
    const frames = this.parseStackTrace(stackTrace);
    if (frames.length === 0) {
      return "❌ Could not parse stack trace. Please ensure it's in a valid format.";
    }

    let analysis = "## 🔍 Stack Trace Analysis\n\n";
    analysis += "**Parsed Stack Trace:**\n";
    
    frames.forEach((frame, index) => {
      analysis += `${index + 1}. \`${frame.function || '<anonymous>'}\`\n`;
      analysis += `   📁 ${frame.filename}:${frame.line}\n`;
    });

    analysis += "\n**Code Context:**\n\n";

    for (const frame of frames.slice(0, 5)) { // Analyze top 5 frames
      const fileAnalysis = await this.analyzeFileForStackFrame(frame, codebasePath);
      if (fileAnalysis) {
        analysis += fileAnalysis + "\n";
      }
    }

    return analysis;
  }

  private async analyzeFileForStackFrame(frame: StackTraceFrame, codebasePath: string): Promise<string | null> {
    const possiblePaths = [
      path.join(codebasePath, frame.filename),
      path.join(codebasePath, 'src', frame.filename),
      path.join(codebasePath, 'app', frame.filename),
    ];

    for (const filePath of possiblePaths) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const targetLine = frame.line - 1; // Convert to 0-based index

        if (targetLine >= 0 && targetLine < lines.length) {
          const contextLines = this.getContextLines(lines, targetLine, 3);
          
          let analysis = `### 📄 \`${frame.filename}\` (Line ${frame.line})\n\n`;
          analysis += "```" + this.getFileExtension(frame.filename) + "\n";
          
          contextLines.forEach(({ lineNumber, content, context }) => {
            const marker = context === 'target' ? '→ ' : '  ';
            analysis += `${marker}${lineNumber}: ${content}\n`;
          });
          
          analysis += "```\n";

          // Add function context if available
          const functionName = this.findContainingFunction(lines, targetLine);
          if (functionName) {
            analysis += `🔧 **Function:** \`${functionName}\`\n`;
          }

          return analysis;
        }
      } catch (error) {
        continue; // Try next path
      }
    }

    return `❓ **File not found:** \`${frame.filename}\` - May be from external library or different path structure.\n`;
  }

  private parseStackTrace(stackTrace: string): StackTraceFrame[] {
    const frames: StackTraceFrame[] = [];
    const lines = stackTrace.split('\n');

    for (const line of lines) {
      // Match various stack trace formats, prioritizing Ruby
      const patterns = [
        // Ruby: "from /path/file.rb:123:in `method_name'"
        /from\s+(.+?):(\d+):in\s+`(.+?)'/,
        // Ruby (simpler): "/path/file.rb:123:in `method_name'"
        /(.+?):(\d+):in\s+`(.+?)'/,
        // Ruby error: "/path/file.rb:123"
        /(.+\.rb):(\d+)/,
        // JavaScript/TypeScript: "at functionName (file.js:123:45)"
        /at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/,
        // Python: "File "/path/file.py", line 123, in function_name"
        /File\s+"(.+?)",\s+line\s+(\d+),\s+in\s+(.+)/,
        // Java: "at com.example.Class.method(File.java:123)"
        /at\s+(.+?)\((.+?):(\d+)\)/,
        // Generic: "functionName file.ext:123"
        /(\w+)\s+(.+?):(\d+)/,
      ];

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          let filename: string, functionName: string, lineNum: number, columnNum: number | undefined;

          if (pattern.source.includes('from\\s+')) {
            // Ruby "from" format
            [, filename, lineNum, functionName] = match.map((m, i) => i === 2 ? parseInt(m) : m) as [string, string, number, string];
          } else if (pattern.source.includes('in\\s+`')) {
            // Ruby "in `method`" format
            [, filename, lineNum, functionName] = match.map((m, i) => i === 2 ? parseInt(m) : m) as [string, string, number, string];
          } else if (pattern.source.includes('\\.rb')) {
            // Ruby simple format
            [, filename, lineNum] = match.map((m, i) => i === 2 ? parseInt(m) : m) as [string, string, number];
            functionName = '<unknown>';
          } else if (pattern.source.includes('File\\s+')) {
            // Python format
            [, filename, lineNum, functionName] = match.map((m, i) => i === 2 ? parseInt(m) : m) as [string, string, number, string];
          } else if (match.length >= 4) {
            // JavaScript/TypeScript format
            [, functionName, filename, lineNum, columnNum] = match.map((m, i) => i >= 3 ? parseInt(m) : m) as [string, string, string, number, number];
          } else {
            // Generic format
            [, functionName, filename, lineNum] = match.map((m, i) => i === 3 ? parseInt(m) : m) as [string, string, string, number];
          }

          frames.push({
            filename: filename.replace(/^.*[\\\/]/, ''), // Get just the filename
            function: functionName,
            line: lineNum,
            column: columnNum,
          });
          break;
        }
      }
    }

    return frames;
  }

  private getContextLines(lines: string[], targetLine: number, contextSize: number) {
    const result = [];
    const start = Math.max(0, targetLine - contextSize);
    const end = Math.min(lines.length, targetLine + contextSize + 1);

    for (let i = start; i < end; i++) {
      result.push({
        lineNumber: i + 1,
        content: lines[i],
        context: i < targetLine ? 'before' as const : 
                i === targetLine ? 'target' as const : 'after' as const,
      });
    }

    return result;
  }

  private findContainingFunction(lines: string[], targetLine: number): string | null {
    // Look backwards from target line to find function declaration
    for (let i = targetLine; i >= 0; i--) {
      const line = lines[i].trim();
      
      // Ruby and other language function patterns, prioritizing Ruby
      const patterns = [
        // Ruby method definitions
        /def\s+(?:self\.)?(\w+[!?]?)/,
        // Ruby class method definitions
        /def\s+self\.(\w+[!?]?)/,
        // Ruby lambda/proc definitions
        /(\w+)\s*=\s*(?:lambda|proc)\s*{/,
        /(\w+)\s*=\s*->\s*\(/,
        // JavaScript/TypeScript function patterns
        /function\s+(\w+)/,
        /(\w+)\s*:\s*function/,
        /(\w+)\s*\([^)]*\)\s*{/,
        /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>/,
        /(\w+)\s*=\s*\([^)]*\)\s*=>/,
        // Python function pattern
        /def\s+(\w+)/,
        // Java method pattern
        /(?:public|private|protected)?\s*(?:static)?\s*\w+\s+(\w+)\s*\(/,
      ];

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          return match[1];
        }
      }
    }

    return null;
  }

  private extractFunctions(content: string): string[] {
    const functions = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      const patterns = [
        // Ruby method definitions (prioritized)
        /def\s+(?:self\.)?(\w+[!?]?)/g,
        /(\w+)\s*=\s*(?:lambda|proc)\s*{/g,
        /(\w+)\s*=\s*->\s*\(/g,
        // Other languages
        /function\s+(\w+)/g,
        /(\w+)\s*:\s*function/g,
        /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>/g,
        /def\s+(\w+)/g, // Python
        /(?:public|private|protected)?\s*(?:static)?\s*\w+\s+(\w+)\s*\(/g, // Java
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(trimmed)) !== null) {
          functions.push(match[1]);
        }
      }
    }

    return [...new Set(functions)]; // Remove duplicates
  }

  private extractImports(content: string): string[] {
    const imports = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      const patterns = [
        // Ruby requires and includes (prioritized)
        /require\s+['"]([^'"]+)['"]/g,
        /require_relative\s+['"]([^'"]+)['"]/g,
        /load\s+['"]([^'"]+)['"]/g,
        /include\s+([A-Z]\w*(?:::[A-Z]\w*)*)/g,
        /extend\s+([A-Z]\w*(?:::[A-Z]\w*)*)/g,
        /gem\s+['"]([^'"]+)['"]/g,
        // Other languages
        /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
        /import\s+['"]([^'"]+)['"]/g,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /from\s+([^\s]+)\s+import/g, // Python
        /import\s+([^\s;]+)/g, // Java
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(trimmed)) !== null) {
          imports.push(match[1]);
        }
      }
    }

    return [...new Set(imports)]; // Remove duplicates
  }

  private async loadGitignore(codebasePath: string) {
    try {
      const gitignorePath = path.join(codebasePath, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      this.gitignorePatterns = ignore().add(content);
    } catch (error) {
      this.gitignorePatterns = null;
    }
  }

  private filterIgnoredFiles(files: string[]): string[] {
    if (!this.gitignorePatterns) {
      return files;
    }
    return this.gitignorePatterns.filter(files);
  }

  private getFileExtension(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const extMap: Record<string, string> = {
      '.rb': 'ruby',
      '.erb': 'erb',
      '.rake': 'ruby',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.php': 'php',
      '.cs': 'csharp',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c',
    };
    return extMap[ext] || '';
  }
} 