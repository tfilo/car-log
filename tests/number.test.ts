import { expect, test } from 'vitest';
import { displayNumber, roundNumber } from '../src/common/number';

test.each([
    [1.005, 1.01],
    [1.2349996, 1.23],
    [1.235, 1.24],
    [9.999, 10],
    [0.0000001, 0],
    [0, 0]
])('rounds %s for display', (value, expected) => {
    expect(roundNumber(value)).toBe(expected);
});

test('formats Slovak numbers and preserves requested decimal places', () => {
    expect(displayNumber(125000.5)).toBe('125\u00a0000,5');
    expect(displayNumber(12.5, 2)).toBe('12,50');
    expect(displayNumber(1.005, 2)).toBe('1,01');
    expect(roundNumber(0.0000005, 6)).toBe(0.000001);
});
