import { existsSync, readFileSync } from 'fs';
import { RoutingConfigService } from '../routing-config.service';

jest.mock('fs');

const mockExistsSync = existsSync as jest.Mock;
const mockReadFileSync = readFileSync as jest.Mock;

function setConfigFile(content: string): void {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(content);
}

describe('RoutingConfigService', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('throws when routing.config.json does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => new RoutingConfigService()).toThrow(/routing\.config\.json not found/);
  });

  it('throws on invalid JSON', () => {
    setConfigFile('{ not valid json');

    expect(() => new RoutingConfigService()).toThrow(/Invalid JSON in routing\.config\.json/);
  });

  it('throws when two repositories share the same label', () => {
    setConfigFile(
      JSON.stringify({
        repositories: [
          { label: 'repo-a', path: '/repos/a' },
          { label: 'repo-a', path: '/repos/a2' },
        ],
      }),
    );

    expect(() => new RoutingConfigService()).toThrow(/Duplicate repository label: "repo-a"/);
  });

  it('loads a valid config and resolves repo path, skill mapping, and default policy', () => {
    setConfigFile(
      JSON.stringify({
        repositories: [
          {
            label: 'repo-a',
            path: '/repos/a',
            issueLabelToSkill: { 'agent-implement': 'implement' },
          },
        ],
      }),
    );

    const service = new RoutingConfigService();

    expect(service.getRepoPath('repo-a')).toBe('/repos/a');
    expect(service.getSkillForMode('repo-a', 'agent-implement')).toBe('implement');
    expect(service.getPolicy()).toEqual({ skipDoneIssues: false, duplicateRunWindowMs: 60_000 });
  });

  describe('mapping resolution', () => {
    it('accepts a repo as a bare path and uses the folder name as its label', () => {
      setConfigFile(JSON.stringify({ repositories: ['/repos/my.repo/'] }));

      const service = new RoutingConfigService();

      expect(service.getRepositoryLabels()).toEqual(['my-repo']);
      expect(service.getRepoPath('my-repo')).toBe('/repos/my.repo/');
    });

    it('exposes nothing unless skills are listed', () => {
      setConfigFile(JSON.stringify({ repositories: ['/repos/a'] }));

      expect(new RoutingConfigService().getValidModesForRepo('a')).toEqual([]);
    });

    it('maps agent-<name> to /<name> for top-level skills in every repo', () => {
      setConfigFile(JSON.stringify({ skills: ['implement', 'plan'], repositories: ['/repos/a', '/repos/b'] }));

      const service = new RoutingConfigService();

      expect(service.getValidModesForRepo('a')).toEqual(['agent-implement', 'agent-plan']);
      expect(service.getSkillForMode('b', 'agent-implement')).toBe('implement');
    });

    it('adds a repo\'s own skills on top of the top-level ones, only for that repo', () => {
      setConfigFile(
        JSON.stringify({
          skills: ['implement'],
          repositories: [{ path: '/repos/a', skills: ['fix-bug', 'implement'] }, '/repos/b'],
        }),
      );

      const service = new RoutingConfigService();

      expect(service.getValidModesForRepo('a')).toEqual(['agent-fix-bug', 'agent-implement']);
      expect(service.getValidModesForRepo('b')).toEqual(['agent-implement']);
    });

    it('lets issueLabelToSkill map a label to a differently named skill', () => {
      setConfigFile(
        JSON.stringify({
          skills: ['implement'],
          repositories: [{ path: '/repos/a', issueLabelToSkill: { 'agent-implement': 'build', 'agent-review': 'code-review' } }],
        }),
      );

      const service = new RoutingConfigService();

      expect(service.getSkillForMode('a', 'agent-implement')).toBe('build');
      expect(service.getSkillForMode('a', 'agent-review')).toBe('code-review');
    });

    it('expands ~ in repo paths', () => {
      setConfigFile(JSON.stringify({ repositories: ['~/code/a'] }));

      expect(new RoutingConfigService().getRepoPath('a')).toBe(`${require('os').homedir()}/code/a`);
    });
  });

  describe('schema validation', () => {
    it.each([
      ['an unknown top-level key', { repositorys: [], repositories: [{ label: 'a', path: '/a' }] }, /repositorys/],
      ['an invalid repo label', { repositories: [{ label: 'my repo', path: '/a' }] }, /repositories\.0\.label/],
      ['an invalid issue label', { repositories: [{ label: 'a', path: '/a', issueLabelToSkill: { 'bad label': 'x' } }] }, /issueLabelToSkill/],
      ['an empty repositories array', { repositories: [] }, /at least one repository/],
      ['a negative duplicate window', { policy: { duplicateRunWindowMs: -1 }, repositories: [{ label: 'a', path: '/a' }] }, /duplicateRunWindowMs/],
    ])('rejects %s', (_name, config, message) => {
      setConfigFile(JSON.stringify(config));

      expect(() => new RoutingConfigService()).toThrow(message);
    });
  });
});
