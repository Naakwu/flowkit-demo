import { describe, expect, it } from 'bun:test';
import { buildInitialState, lintFlow, lintInterpreterFlow, validateRegistryRefs } from '@flowkit/core';
import { publishDefinition, verifyPublishedDefinition } from '@flowkit/temporal';
import { leaveDefinition } from '../src/leave/leave.definition';
import { leaveChannels, leaveGuards, leavePolicies, leaveRules, leaveSystemSteps, leaveTemplates } from '../src/leave/leave.registries';

describe('leave approval definition', () => {
  it('is strict, lint-clean, and has a stable immutable snapshot', () => {
    expect(lintFlow(leaveDefinition)).toEqual([]);
    expect(lintInterpreterFlow(leaveDefinition)).toEqual([]);
    expect(validateRegistryRefs(leaveDefinition, { guards: leaveGuards, policies: leavePolicies, steps: { ...leaveSystemSteps, ...leaveRules }, templates: leaveTemplates, channels: leaveChannels })).toEqual([]);
    const published = publishDefinition({ definition: leaveDefinition });
    verifyPublishedDefinition(published);
    expect(Object.isFrozen(published.definitionSnapshot)).toBe(true);
    expect(buildInitialState(leaveDefinition).stage).toBe('employee_draft');
  });
});
