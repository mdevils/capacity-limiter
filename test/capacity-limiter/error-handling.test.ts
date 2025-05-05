import {CapacityLimiter, CapacityLimiterError} from '../../src/index.js';
import {setupFakeTimers, teardownFakeTimers, createDefaultLimiter} from '../common/test-utils.js';

describe('CapacityLimiter: Error Handling', () => {
    let limiter: CapacityLimiter;

    beforeEach(() => {
        setupFakeTimers();
        limiter = createDefaultLimiter();
    });

    afterEach(() => {
        teardownFakeTimers();
    });

    it('should handle rejected promises from tasks', async () => {
        const mockCallback = jest.fn().mockRejectedValue(new Error('Task failed'));

        await expect(limiter.schedule(5, mockCallback)).rejects.toThrow('Task failed');
        expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should handle thrown errors from tasks', async () => {
        const mockCallback = jest.fn().mockImplementation(() => {
            throw new Error('Task threw error');
        });

        await expect(limiter.schedule(5, mockCallback)).rejects.toThrow('Task threw error');
        expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should reject with CapacityLimiterError for invalid arguments', async () => {
        expect(() => limiter.schedule('not a function' as never)).toThrow(
            new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Expected a function as the argument at position 1.'
            )
        );

        expect(() => limiter.schedule(5, 'not a function' as never)).toThrow(
            new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Expected a function as the argument at position 2.'
            )
        );
    });

    it('should throw error when task capacity exceeds max with throw-error strategy', async () => {
        const limiterWithStrictCapacity = new CapacityLimiter({
            maxCapacity: 10,
            taskExceedsMaxCapacityStrategy: 'throw-error'
        });

        // Fill up some capacity so we're not at zero
        await limiterWithStrictCapacity.schedule(5, () => Promise.resolve());

        // Now try a task with too much capacity
        expect(() => limiterWithStrictCapacity.schedule(11, () => Promise.resolve())).toThrow(
            new CapacityLimiterError('max-capacity-exceeded', 'Task capacity (11) exceeds max capacity (10).')
        );
    });

    it('should cap task capacity when exceeding max with wait-for-full-capacity strategy', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            taskExceedsMaxCapacityStrategy: 'wait-for-full-capacity'
        });

        // Fill capacity partially
        const firstPromise = limiter.schedule(5, () => Promise.resolve());

        // Try to schedule task with capacity > maxCapacity
        // With non-zero current capacity, this should wait
        const largeTask = jest.fn().mockResolvedValue('large result');
        const largePromise = limiter.schedule(15, largeTask);

        // Task should not run yet
        expect(largeTask).toHaveBeenCalledTimes(0);

        // Schedule and complete more tasks to use and then release all capacity
        const cleanupPromise = limiter.schedule(5, () => Promise.resolve('cleanup'));

        // Task should not run yet
        expect(largeTask).toHaveBeenCalledTimes(0);

        await Promise.all([firstPromise, cleanupPromise]);

        // Now capacity should be zero, large task should run
        expect(largeTask).toHaveBeenCalledTimes(1);

        const result = await largePromise;
        expect(result).toBe('large result');
    });

    it('should handle queue size exceeded with throw-error strategy', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            maxQueueSize: 1,
            queueSizeExceededStrategy: 'throw-error'
        });

        // Fill capacity so tasks will queue
        const firstPromise = limiter.schedule(10, () => Promise.resolve());

        // Queue one task (filling the queue)
        const secondPromise = limiter.schedule(5, () => Promise.resolve('first'));

        await Promise.all([
            // Try to queue a second task - should throw immediately
            expect(limiter.schedule(5, () => Promise.resolve('second'))).rejects.toThrow(CapacityLimiterError),
            expect(limiter.schedule(5, () => Promise.resolve('second'))).rejects.toMatchObject({
                type: 'queue-size-exceeded'
            })
        ]);

        await firstPromise;

        // The first task should still execute when capacity is available
        jest.runAllTimers();
        const result = await secondPromise;
        expect(result).toBe('first');
    });

    it('should properly clean up resources when a task fails', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            capacityStrategy: 'reserve'
        });

        // Try to execute a failing task
        const failingTask = jest.fn().mockRejectedValue(new Error('Task failed'));

        // This will fail but should clean up capacity
        await expect(limiter.schedule(8, failingTask)).rejects.toThrow('Task failed');

        // Now we should be able to schedule a task that uses full capacity
        const successTask = jest.fn().mockResolvedValue('success');
        const successPromise = limiter.schedule(10, successTask);

        // If capacity was properly released, this task should run immediately
        expect(successTask).toHaveBeenCalledTimes(1);

        const result = await successPromise;
        expect(result).toBe('success');
    });

    it('should properly clean up resources when a task fails sync', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            capacityStrategy: 'reserve'
        });

        // Try to execute a failing task
        const failingTask = jest.fn().mockImplementation(() => {
            throw new Error('Task failed');
        });

        // This will fail but should clean up capacity
        await expect(limiter.schedule(8, failingTask)).rejects.toThrow('Task failed');

        // Now we should be able to schedule a task that uses full capacity
        const successTask = jest.fn().mockResolvedValue('success');
        const successPromise = limiter.schedule(10, successTask);

        // If capacity was properly released, this task should run immediately
        expect(successTask).toHaveBeenCalledTimes(1);

        const result = await successPromise;
        expect(result).toBe('success');
    });
});
