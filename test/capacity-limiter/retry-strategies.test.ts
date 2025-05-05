import {CapacityLimiter, CapacityLimiterError, OnFailureParams} from '../../src/index.js';
import {createWaitableFn, setupFakeTimers, teardownFakeTimers} from '../common/test-utils.js';

describe('CapacityLimiter: Retry Strategies', () => {
    let limiter: CapacityLimiter;

    beforeEach(() => {
        setupFakeTimers();
        limiter = new CapacityLimiter({maxCapacity: 10});
    });

    afterEach(() => {
        teardownFakeTimers();
    });

    it('should retry failed tasks with retry strategy', async () => {
        let attemptCount = 0;
        const mockTask = jest.fn().mockImplementation(() => {
            attemptCount++;
            if (attemptCount === 1) {
                return Promise.reject(new Error('First attempt failed'));
            }
            return Promise.resolve(`Success on retry ${attemptCount}`);
        });

        // Schedule task with retry strategy
        const promise = limiter.schedule({
            task: mockTask,
            capacity: 3,
            failRecoveryStrategy: 'retry' // Default retry strategy
        });

        // First attempt fails
        expect(mockTask).toHaveBeenCalledTimes(1);

        await Promise.resolve(); // Allow the promise to settle

        // Advance time to allow for retry
        jest.advanceTimersByTime(100); // Default retry is 1000ms

        expect(mockTask).toHaveBeenCalledTimes(1);

        // Advance time to allow for retry
        jest.advanceTimersByTime(2000); // Default retry is 1000ms

        // Second attempt succeeds
        expect(mockTask).toHaveBeenCalledTimes(2);

        const result = await promise;
        expect(result).toBe('Success on retry 2');
    });

    it('should support custom retry options', async () => {
        let attemptCount = 0;
        const mockTask = jest.fn().mockImplementation(() => {
            attemptCount++;
            if (attemptCount <= 2) {
                return Promise.reject(new Error(`Attempt ${attemptCount} failed`));
            }
            return Promise.resolve(`Success on retry ${attemptCount}`);
        });

        // Schedule task with custom retry strategy
        const promise = limiter.schedule({
            task: mockTask,
            capacity: 3,
            failRecoveryStrategy: {
                type: 'retry',
                minTimeout: 50, // Short timeout for testing
                maxTimeout: 100,
                retries: 3, // Allow up to 3 retries
                factor: 1 // No backoff for simplicity
            }
        });

        // First attempt fails
        expect(mockTask).toHaveBeenCalledTimes(1);

        await Promise.resolve(); // Allow the promise to settle

        // First retry
        jest.advanceTimersByTime(60);
        expect(mockTask).toHaveBeenCalledTimes(2);

        await Promise.resolve(); // Allow the promise to settle

        // Second retry succeeds
        jest.advanceTimersByTime(60);
        expect(mockTask).toHaveBeenCalledTimes(3);

        const result = await promise;
        expect(result).toBe('Success on retry 3');
    });

    it('should give up after max retries', async () => {
        const mockTask = jest.fn().mockRejectedValue(new Error('Task always fails'));

        // Schedule task with limited retries
        const promise = limiter.schedule({
            task: mockTask,
            capacity: 3,
            failRecoveryStrategy: {
                type: 'retry',
                minTimeout: 50, // Short timeout for testing
                retries: 2 // Only 2 retries
            }
        });

        // Initial attempt
        expect(mockTask).toHaveBeenCalledTimes(1);

        await Promise.resolve(); // Allow the promise to settle

        // First retry
        jest.advanceTimersByTime(60);

        expect(mockTask).toHaveBeenCalledTimes(2);

        await Promise.resolve(); // Allow the promise to settle

        // Second retry
        jest.advanceTimersByTime(120);
        expect(mockTask).toHaveBeenCalledTimes(3);

        // Should give up after 2 retries (3 attempts total)
        jest.advanceTimersByTime(240);
        expect(mockTask).toHaveBeenCalledTimes(3); // No more calls

        // Promise should reject with the original error
        await expect(promise).rejects.toThrow('Task always fails');
    });

    it('should use exponential backoff for retries', async () => {
        const mockTask = jest.fn().mockRejectedValue(new Error('Task failed'));

        // Schedule task with exponential backoff
        const promise = limiter.schedule({
            task: mockTask,
            capacity: 3,
            failRecoveryStrategy: {
                type: 'retry',
                minTimeout: 100,
                factor: 2,
                retries: 3
            }
        });

        // First attempt at time 0
        expect(mockTask).toHaveBeenCalledTimes(1);

        await Promise.resolve(); // Allow the promise to settle

        // First retry should be around 100ms
        jest.advanceTimersByTime(110);

        expect(mockTask).toHaveBeenCalledTimes(2);

        await Promise.resolve(); // Allow the promise to settle

        // Second retry should be around 200ms later (factor=2)
        jest.advanceTimersByTime(210);
        expect(mockTask).toHaveBeenCalledTimes(3);

        await Promise.resolve(); // Allow the promise to settle

        // Third retry should be around 400ms later
        jest.advanceTimersByTime(410);
        expect(mockTask).toHaveBeenCalledTimes(4);

        // Task should eventually fail after all retries
        await expect(promise).rejects.toThrow('Task failed');
    });

    it('should support custom failure handlers', async () => {
        const mockTask = jest.fn().mockRejectedValue(new Error('Original error'));

        // Custom failure handler that returns a custom error after one retry
        const customOnFailure = createWaitableFn(({retryAttempt}: OnFailureParams) => {
            if (retryAttempt === 1) {
                return Promise.resolve({
                    type: 'retry',
                    timeout: 50
                });
            }
            return Promise.resolve({
                type: 'throw-error',
                error: new Error('Custom error after retry')
            });
        });

        // Schedule task with custom failure handler
        const promise = limiter.schedule({
            task: mockTask,
            capacity: 3,
            failRecoveryStrategy: {
                type: 'custom',
                onFailure: customOnFailure.fn
            }
        });

        // Initial attempt fails
        expect(mockTask).toHaveBeenCalledTimes(1);

        await customOnFailure.waitForCall();

        expect(customOnFailure.fn).toHaveBeenCalledTimes(1);
        expect(customOnFailure.fn).toHaveBeenLastCalledWith({
            error: expect.any(Error),
            retryAttempt: 1
        });

        await Promise.resolve(); // Allow the promise to settle

        // Handler should request retry
        jest.advanceTimersByTime(60);

        // Handler should throw custom error
        await expect(promise).rejects.toThrow('Custom error after retry');

        // Second failure
        expect(customOnFailure.fn).toHaveBeenCalledTimes(2);
        expect(customOnFailure.fn).toHaveBeenLastCalledWith({
            error: expect.any(Error),
            retryAttempt: 2
        });
    });

    it('should handle errors in the custom failure handler', async () => {
        const mockTask = jest.fn().mockRejectedValue(new Error('Task error'));

        // Failure handler that rejects with its own error
        const failingHandler = jest.fn().mockImplementation(() => Promise.reject(new Error('Handler error')));

        // Schedule task with failing handler
        const promise = limiter.schedule({
            task: mockTask,
            capacity: 3,
            failRecoveryStrategy: {
                type: 'custom',
                onFailure: failingHandler
            }
        });

        // Verify task ran and handler was called
        expect(mockTask).toHaveBeenCalledTimes(1);

        // Promise should reject with CapacityLimiterError wrapping the handler error
        await expect(promise).rejects.toThrow(CapacityLimiterError);
        await expect(promise).rejects.toMatchObject({
            type: 'on-failure-error',
            originalError: expect.any(Error)
        });

        expect(failingHandler).toHaveBeenCalledTimes(1);
    });

    it('should allow limiter-level retry strategy to be overridden by task-level strategy', async () => {
        // Create limiter with default retry strategy
        const limiterWithRetry = new CapacityLimiter({
            maxCapacity: 10,
            failRecoveryStrategy: 'retry'
        });

        // Task that always fails
        const mockTask = jest.fn().mockRejectedValue(new Error('Task error'));

        // Schedule task with 'none' recovery strategy, overriding limiter default
        const promise = limiterWithRetry.schedule({
            task: mockTask,
            capacity: 3,
            failRecoveryStrategy: 'none'
        });

        // Task should run once
        expect(mockTask).toHaveBeenCalledTimes(1);

        // Advance time beyond retry period
        jest.advanceTimersByTime(1100);

        // No retry should happen
        expect(mockTask).toHaveBeenCalledTimes(1);

        // Promise should reject immediately
        await expect(promise).rejects.toThrow('Task error');
    });

    it('should inherit limiter-level retry strategy when task-level strategy is not specified', async () => {
        // Create limiter with custom retry strategy
        const limiterWithRetry = new CapacityLimiter({
            maxCapacity: 10,
            failRecoveryStrategy: {
                type: 'retry',
                minTimeout: 50,
                retries: 1
            }
        });

        let attemptCount = 0;
        const mockTask = jest.fn().mockImplementation(() => {
            attemptCount++;
            if (attemptCount === 1) {
                return Promise.reject(new Error('First attempt failed'));
            }
            return Promise.resolve('Success on retry');
        });

        // Schedule task without specifying recovery strategy
        const promise = limiterWithRetry.schedule({
            task: mockTask,
            capacity: 3
        });

        // First attempt fails
        expect(mockTask).toHaveBeenCalledTimes(1);

        await Promise.resolve(); // Allow the promise to settle

        // Advance time to trigger retry
        jest.advanceTimersByTime(60);

        // Should retry based on limiter strategy
        expect(mockTask).toHaveBeenCalledTimes(2);

        const result = await promise;
        expect(result).toBe('Success on retry');
    });
});
