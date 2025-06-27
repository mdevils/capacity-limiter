import {CapacityLimiter} from '../../src/index.js';
import {
    createDefaultLimiter,
    createControlledPromise,
    setupFakeTimers,
    teardownFakeTimers
} from '../common/test-utils.js';

/**
 * Tests for the wrap() method of the CapacityLimiter.
 * These tests focus on the function wrapping behavior and parameter handling.
 */
describe('CapacityLimiter: wrap() method', () => {
    let limiter: CapacityLimiter;

    beforeEach(() => {
        limiter = createDefaultLimiter();
        setupFakeTimers();
    });

    afterEach(() => {
        teardownFakeTimers();
    });

    describe('function parameter overload', () => {
        it('should wrap a simple async function', async () => {
            const originalFn = jest.fn().mockResolvedValue('test result');
            const wrappedFn = limiter.wrap(originalFn);

            const result = await wrappedFn();

            expect(originalFn).toHaveBeenCalledTimes(1);
            expect(result).toBe('test result');
        });

        it('should wrap a function with parameters', async () => {
            const originalFn = jest.fn().mockImplementation(async (a: number, b: string) => `${a}-${b}`);
            const wrappedFn = limiter.wrap(originalFn);

            const result = await wrappedFn(42, 'hello');

            expect(originalFn).toHaveBeenCalledWith(42, 'hello');
            expect(result).toBe('42-hello');
        });

        it('should wrap a function that throws an error', async () => {
            const error = new Error('Function error');
            const originalFn = jest.fn().mockRejectedValue(error);
            const wrappedFn = limiter.wrap(originalFn);

            await expect(wrappedFn()).rejects.toThrow('Function error');
            expect(originalFn).toHaveBeenCalledTimes(1);
        });

        it('should maintain function signature and type safety', async () => {
            const originalFn = async (num: number, str: string, bool: boolean): Promise<string> =>
                `${num}-${str}-${bool}`;
            const wrappedFn = limiter.wrap(originalFn);

            const result = await wrappedFn(123, 'test', true);
            expect(result).toBe('123-test-true');
        });

        it('should use default capacity when wrapping function directly', async () => {
            const originalFn = jest.fn().mockResolvedValue('result');
            const wrappedFn = limiter.wrap(originalFn);

            // Fill the limiter to capacity with default capacity (1)
            const {promise: fillPromise, resolve: resolveFill} = createControlledPromise();
            const fillTask = jest.fn().mockImplementation(() => fillPromise);

            // Fill with 10 capacity (max)
            limiter.schedule(10, fillTask);

            // Now try to run wrapped function - should be queued
            const wrappedPromise = wrappedFn();

            // Original function should not be called yet
            expect(originalFn).toHaveBeenCalledTimes(0);

            // Free up capacity
            resolveFill('fill done');

            // Now wrapped function should execute
            const result = await wrappedPromise;
            expect(originalFn).toHaveBeenCalledTimes(1);
            expect(result).toBe('result');
        });
    });

    describe('WrappedTaskParams parameter overload', () => {
        it('should wrap a function with custom capacity', async () => {
            const originalFn = jest.fn().mockResolvedValue('result');
            const wrappedFn = limiter.wrap({
                task: originalFn,
                capacity: 5
            });

            const result = await wrappedFn();

            expect(originalFn).toHaveBeenCalledTimes(1);
            expect(result).toBe('result');
        });

        it('should wrap a function with priority', async () => {
            const executionOrder: string[] = [];

            const lowPriorityFn = jest.fn().mockImplementation(async () => {
                executionOrder.push('low');
                return 'low';
            });
            const highPriorityFn = jest.fn().mockImplementation(async () => {
                executionOrder.push('high');
                return 'high';
            });

            const wrappedLowPriority = limiter.wrap({
                task: lowPriorityFn,
                capacity: 5,
                priority: 8
            });
            const wrappedHighPriority = limiter.wrap({
                task: highPriorityFn,
                capacity: 5,
                priority: 2
            });

            // Fill capacity first
            const {promise: fillPromise, resolve: resolveFill} = createControlledPromise();
            const fillTask = jest.fn().mockImplementation(() => fillPromise);
            limiter.schedule(10, fillTask);

            // Queue both wrapped functions
            const lowPromise = wrappedLowPriority();
            const highPromise = wrappedHighPriority();

            // Neither should execute yet
            expect(executionOrder).toEqual([]);

            // Free capacity
            resolveFill('fill done');

            await Promise.all([lowPromise, highPromise]);

            // High priority should execute first
            expect(executionOrder).toEqual(['high', 'low']);
        });

        it('should wrap a function with timeout configuration', async () => {
            const slowFn = jest
                .fn()
                .mockImplementation(
                    async () => new Promise((resolve) => setTimeout(() => resolve('slow result'), 2000))
                );

            const wrappedFn = limiter.wrap({
                task: slowFn,
                executionTimeout: 1000
            });

            const promise = wrappedFn();

            // Advance time past timeout
            jest.advanceTimersByTime(1500);

            await expect(promise).rejects.toThrow();
        });

        it('should wrap a function with queue waiting timeout', async () => {
            const originalFn = jest.fn().mockResolvedValue('result');
            const wrappedFn = limiter.wrap({
                task: originalFn,
                capacity: 5,
                queueWaitingTimeout: 1000
            });

            // Fill capacity
            const {promise: fillPromise} = createControlledPromise();
            const fillTask = jest.fn().mockImplementation(() => fillPromise);
            limiter.schedule(10, fillTask);

            // Queue wrapped function
            const wrappedPromise = wrappedFn();

            // Advance time past queue waiting timeout
            jest.advanceTimersByTime(1500);

            await expect(wrappedPromise).rejects.toThrow();
        });

        it('should wrap a function with retry configuration', async () => {
            let callCount = 0;
            const flakyFn = jest.fn().mockImplementation(async () => {
                callCount++;
                if (callCount < 3) {
                    throw new Error('Temporary failure');
                }
                return 'success after retries';
            });

            const wrappedFn = limiter.wrap({
                task: flakyFn,
                failRecoveryStrategy: 'retry'
            });

            const result = wrappedFn();

            await Promise.resolve(); // Ensure the promise is scheduled
            jest.advanceTimersByTime(10000); // Advance timers to trigger retries

            await Promise.resolve(); // Ensure the promise is scheduled
            jest.advanceTimersByTime(10000); // Advance timers to trigger retries

            await Promise.resolve(); // Ensure the promise is scheduled
            jest.advanceTimersByTime(10000); // Advance timers to trigger retries

            expect(flakyFn).toHaveBeenCalledTimes(3);
            expect(await result).toBe('success after retries');
        });

        it('should wrap a function with all configuration options', async () => {
            const originalFn = jest.fn().mockResolvedValue('configured result');
            const wrappedFn = limiter.wrap({
                task: originalFn,
                capacity: 3,
                priority: 5,
                queueWaitingLimit: 100,
                queueWaitingTimeout: 5000,
                executionTimeout: 3000,
                failRecoveryStrategy: 'retry'
            });

            const result = await wrappedFn();

            expect(originalFn).toHaveBeenCalledTimes(1);
            expect(result).toBe('configured result');
        });
    });

    describe('capacity management with wrapped functions', () => {
        it('should respect capacity limits when executing wrapped functions', async () => {
            const fn1 = jest.fn().mockResolvedValue('result1');
            const fn2 = jest.fn().mockResolvedValue('result2');

            const wrappedFn1 = limiter.wrap({task: fn1, capacity: 6});
            const wrappedFn2 = limiter.wrap({task: fn2, capacity: 6});

            // Both should not fit simultaneously (6 + 6 > 10)
            const promise1 = wrappedFn1();
            const promise2 = wrappedFn2();

            // First should execute, second should be queued
            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).toHaveBeenCalledTimes(0);

            // Wait for first to complete
            await promise1;

            // Second should now execute
            expect(fn2).toHaveBeenCalledTimes(1);
            await promise2;
        });

        it('should handle multiple calls to the same wrapped function', async () => {
            const originalFn = jest.fn().mockImplementation(async (id: number) => `result-${id}`);
            const wrappedFn = limiter.wrap({task: originalFn, capacity: 3});

            const promises = [wrappedFn(1), wrappedFn(2), wrappedFn(3), wrappedFn(4)];

            const results = await Promise.all(promises);

            expect(originalFn).toHaveBeenCalledTimes(4);
            expect(originalFn).toHaveBeenNthCalledWith(1, 1);
            expect(originalFn).toHaveBeenNthCalledWith(2, 2);
            expect(originalFn).toHaveBeenNthCalledWith(3, 3);
            expect(originalFn).toHaveBeenNthCalledWith(4, 4);
            expect(results).toEqual(['result-1', 'result-2', 'result-3', 'result-4']);
        });
    });

    describe('error handling with wrapped functions', () => {
        it('should propagate errors from wrapped functions', async () => {
            const error = new Error('Wrapped function error');
            const errorFn = jest.fn().mockRejectedValue(error);
            const wrappedFn = limiter.wrap(errorFn);

            await expect(wrappedFn()).rejects.toThrow('Wrapped function error');
            expect(errorFn).toHaveBeenCalledTimes(1);
        });

        it('should handle errors with retry configuration', async () => {
            let callCount = 0;
            const flakyFn = jest.fn().mockImplementation(async () => {
                callCount++;
                throw new Error(`Attempt ${callCount} failed`);
            });

            const wrappedFn = limiter.wrap({
                task: flakyFn,
                failRecoveryStrategy: 'retry'
            });

            const promise = wrappedFn();

            for (let i = 1; i <= 10; i++) {
                expect(callCount).toBe(i);
                await Promise.resolve(); // Ensure the promise is scheduled
                jest.advanceTimersToNextTimer(3600000); // Advance timers to trigger retries
            }

            await expect(promise).rejects.toThrow('Attempt 11 failed');
            expect(flakyFn).toHaveBeenCalledTimes(11); // initial + 10 retries
        });
    });

    describe('wrapped function arguments handling', () => {
        it('should pass arguments correctly to wrapped function', async () => {
            const originalFn = jest
                .fn()
                .mockImplementation(async (a: string, b: number, c: boolean, d: object) => ({a, b, c, d}));
            const wrappedFn = limiter.wrap(originalFn);

            const testObj = {key: 'value'};
            const result = await wrappedFn('test', 42, true, testObj);

            expect(originalFn).toHaveBeenCalledWith('test', 42, true, testObj);
            expect(result).toEqual({
                a: 'test',
                b: 42,
                c: true,
                d: testObj
            });
        });

        it('should handle functions with no arguments', async () => {
            const originalFn = jest.fn().mockResolvedValue('no args result');
            const wrappedFn = limiter.wrap(originalFn);

            const result = await wrappedFn();

            expect(originalFn).toHaveBeenCalledWith();
            expect(result).toBe('no args result');
        });

        it('should handle functions with rest parameters', async () => {
            const originalFn = jest
                .fn()
                .mockImplementation(async (...args: number[]) => args.reduce((sum, num) => sum + num, 0));
            const wrappedFn = limiter.wrap(originalFn);

            const result = await wrappedFn(1, 2, 3, 4, 5);

            expect(originalFn).toHaveBeenCalledWith(1, 2, 3, 4, 5);
            expect(result).toBe(15);
        });
    });

    describe('wrapped function with limiter state changes', () => {
        it('should handle wrapped functions when limiter is stopped', async () => {
            const originalFn = jest.fn().mockResolvedValue('result');
            const wrappedFn = limiter.wrap(originalFn);

            await limiter.stop();

            await expect(wrappedFn()).rejects.toThrow();
            expect(originalFn).toHaveBeenCalledTimes(0);
        });

        it('should handle wrapped functions when limiter capacity changes', async () => {
            const originalFn = jest.fn().mockResolvedValue('result');
            const wrappedFn = limiter.wrap({task: originalFn, capacity: 8});

            // Fill current capacity
            const {promise: fillPromise, resolve: resolveFill} = createControlledPromise();
            const fillTask = jest.fn().mockImplementation(() => fillPromise);
            limiter.schedule(10, fillTask);

            // Queue wrapped function
            const wrappedPromise = wrappedFn();
            expect(originalFn).toHaveBeenCalledTimes(0);

            // Increase capacity
            limiter.setOptions({maxCapacity: 20});

            // Function should still wait for fill task to complete
            expect(originalFn).toHaveBeenCalledTimes(0);

            // Complete fill task
            resolveFill('done');

            // Now wrapped function should execute
            const result = await wrappedPromise;
            expect(originalFn).toHaveBeenCalledTimes(1);
            expect(result).toBe('result');
        });
    });
});
