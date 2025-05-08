import {CapacityLimiter, CapacityLimiterError} from '../../src/index.js';
import {createDefaultLimiter} from '../common/test-utils.js';

/**
 * Tests for argument validation in the CapacityLimiter.
 * These tests focus on ensuring proper error handling when invalid arguments are provided.
 */
describe('CapacityLimiter: Invalid Arguments', () => {
    let limiter: CapacityLimiter;

    beforeEach(() => {
        limiter = createDefaultLimiter();
    });

    describe('constructor validation', () => {
        it('should throw when maxCapacity is negative', () => {
            expect(() => new CapacityLimiter({maxCapacity: -1})).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a non-negative number as the maxCapacity.'
                )
            );
        });

        it('should throw when initiallyUsedCapacity is negative', () => {
            expect(() => new CapacityLimiter({maxCapacity: 10, initiallyUsedCapacity: -1})).toThrow(
                CapacityLimiterError
            );
        });

        it('should throw when initiallyUsedCapacity exceeds maxCapacity', () => {
            expect(() => new CapacityLimiter({maxCapacity: 10, initiallyUsedCapacity: 15})).toThrow(
                CapacityLimiterError
            );
        });
    });

    describe('schedule() method validation', () => {
        it('should throw when first argument is not a function or object', () => {
            // String instead of function
            expect(() => limiter.schedule('not a function' as never)).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a function as the argument at position 1.'
                )
            );

            // null instead of function
            expect(() => limiter.schedule(null as never)).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a function as the argument at position 1.'
                )
            );

            // undefined instead of function
            expect(() => limiter.schedule(123 as never)).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a function as the argument at position 2.'
                )
            );
        });

        it('should throw when second argument is not a function (with capacity)', () => {
            // String instead of function with capacity
            expect(() => limiter.schedule(5, 'not a function' as never)).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a function as the argument at position 2.'
                )
            );

            // null instead of function with capacity
            expect(() => limiter.schedule(5, null as never)).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a function as the argument at position 2.'
                )
            );

            // Object instead of function with capacity
            expect(() => limiter.schedule(5, {} as never)).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a function as the argument at position 2.'
                )
            );
        });

        it('should throw when task is not provided in object-style arguments', () => {
            // Empty object
            expect(() => limiter.schedule({} as never)).toThrow(
                new CapacityLimiterError('invalid-argument', 'Invalid argument. Expected a function as the task.')
            );

            // Object with non-function task
            expect(() => limiter.schedule({task: 'not a function'} as never)).toThrow(
                new CapacityLimiterError('invalid-argument', 'Invalid argument. Expected a function as the task.')
            );
        });

        it('should throw when capacity is negative', () => {
            expect(() => limiter.schedule(-1, () => Promise.resolve())).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a non-negative number as the task capacity.'
                )
            );
        });

        it('should throw when priority is outside the valid range', () => {
            expect(() =>
                limiter.schedule({
                    task: () => Promise.resolve(),
                    priority: -1
                })
            ).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a number from 0 to 9 as the task priority.'
                )
            );

            expect(() =>
                limiter.schedule({
                    task: () => Promise.resolve(),
                    priority: 10
                })
            ).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a number from 0 to 9 as the task priority.'
                )
            );
        });
    });

    describe('capacity exceeded validation', () => {
        it('should throw error when task capacity exceeds max capacity with throw-error strategy', async () => {
            // Now try to schedule a task that exceeds remaining capacity
            expect(() => limiter.schedule(11, () => Promise.resolve())).toThrow(
                new CapacityLimiterError('max-capacity-exceeded', 'Task capacity (11) exceeds maxCapacity (10).')
            );
        });

        it('should allow task with capacity exceeding max with wait-for-full-capacity strategy at zero capacity', async () => {
            limiter.setOptions({
                ...limiter.getOptions(),
                taskExceedsMaxCapacityStrategy: 'wait-for-full-capacity'
            });

            // Set capacity to zero
            await limiter.setUsedCapacity(0);

            // Schedule task with capacity > maxCapacity
            const largeTask = jest.fn().mockResolvedValue('large result');
            const largePromise = limiter.schedule(15, largeTask);

            // Task should execute immediately when starting at zero capacity
            expect(largeTask).toHaveBeenCalledTimes(1);

            const result = await largePromise;
            expect(result).toBe('large result');
        });

        it('should queue task with capacity exceeding max with wait-for-full-capacity strategy at non-zero capacity', async () => {
            limiter.setOptions({
                ...limiter.getOptions(),
                taskExceedsMaxCapacityStrategy: 'wait-for-full-capacity'
            });

            // Fill capacity partially
            const partialPromise = limiter.schedule(5, () => Promise.resolve());

            // Schedule task with capacity > maxCapacity
            const largeTask = jest.fn().mockResolvedValue('large result');
            const largePromise = limiter.schedule(15, largeTask);

            // Task should be queued, not executed yet
            expect(largeTask).toHaveBeenCalledTimes(0);

            // Reset capacity to zero
            await partialPromise;

            // Now task should execute
            expect(largeTask).toHaveBeenCalledTimes(1);

            const result = await largePromise;
            expect(result).toBe('large result');
        });
    });

    describe('setUsedCapacity validation', () => {
        it('should throw when setting negative used capacity', async () => {
            expect(() => limiter.setUsedCapacity(-1)).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a non-negative number as the used capacity.'
                )
            );
        });

        it('should throw when setting capacity exceeding max capacity', async () => {
            expect(() => limiter.setUsedCapacity(15)).toThrow(
                new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a number less than or equal to 10 as the used capacity.'
                )
            );
        });
    });
});
