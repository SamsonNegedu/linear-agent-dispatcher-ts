import { existsSync, readdirSync } from 'fs';
import { findSkill, labelForSkill, listRepoSkills } from '../skill-discovery';

jest.mock('fs');

const mockExistsSync = existsSync as jest.Mock;
const mockReaddirSync = readdirSync as jest.Mock;

describe('skill-discovery', () => {
  afterEach(() => jest.resetAllMocks());

  describe('findSkill', () => {
    it('finds a skill in the repo .claude/skills directory', () => {
      mockExistsSync.mockImplementation((p: string) => p === '/repo/.claude/skills/do-it/SKILL.md');

      expect(findSkill('/repo', 'do-it', '/home/u')).toEqual({
        status: 'found',
        location: '/repo/.claude/skills/do-it/SKILL.md',
      });
    });

    it('finds a slash command and falls back to the user-level directory', () => {
      mockExistsSync.mockImplementation((p: string) => p === '/home/u/.claude/commands/do-it.md');

      expect(findSkill('/repo', 'do-it', '/home/u').status).toBe('found');
    });

    it('reports missing when nothing matches', () => {
      mockExistsSync.mockReturnValue(false);

      expect(findSkill('/repo', 'do-it', '/home/u')).toEqual({ status: 'missing' });
    });

    it('does not try to verify plugin-namespaced skills', () => {
      expect(findSkill('/repo', 'plugin:do-it', '/home/u')).toEqual({ status: 'unverifiable' });
      expect(mockExistsSync).not.toHaveBeenCalled();
    });
  });

  describe('listRepoSkills', () => {
    it('returns skills from skills/ and commands/', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((dir: string) =>
        dir.endsWith('skills') ? ['linear-plan', 'implement'] : ['linear-test.md', 'notes.txt'],
      );

      expect(listRepoSkills('/repo')).toEqual(['implement', 'linear-plan', 'linear-test']);
    });

    it('returns nothing when the directories do not exist', () => {
      mockReaddirSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(listRepoSkills('/repo')).toEqual([]);
    });
  });

  describe('labelForSkill', () => {
    it('triggers a skill with agent-<name>', () => {
      expect(labelForSkill('implement')).toBe('agent-implement');
      expect(labelForSkill('fix-bug')).toBe('agent-fix-bug');
    });
  });
});
