import { parseMcpList, toMcpRule } from '../mcp-server-discovery.service';

describe('MCP server discovery helpers', () => {
  it('parses server names from `claude mcp list` output, including names with colons and spaces', () => {
    const output = [
      'Checking MCP server health…',
      '',
      'claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected',
      'plugin:playwright:playwright: npx @playwright/mcp@latest - ✔ Connected',
      'linear-server: https://mcp.linear.app/mcp (HTTP) - ✔ Connected',
      'broken-one: npx some-server - ✗ Failed to connect',
    ].join('\n');

    expect(parseMcpList(output)).toEqual([
      'claude.ai Claude Docs',
      'plugin:playwright:playwright',
      'linear-server',
      'broken-one',
    ]);
  });

  it('returns nothing for output with no servers', () => {
    expect(parseMcpList('No MCP servers configured.')).toEqual([]);
  });

  it('turns a server name into the permission rule Claude Code uses for its tools', () => {
    expect(toMcpRule('linear-server')).toBe('mcp__linear-server');
    expect(toMcpRule('plugin:playwright:playwright')).toBe('mcp__plugin_playwright_playwright');
    expect(toMcpRule('claude.ai Claude Docs')).toBe('mcp__claude_ai_Claude_Docs');
  });
});
