import {CapacityLimiter, CapacityLimiterError} from '../../src/index.js';
import {
    setupFakeTimers,
    teardownFakeTimers,
    createDefaultLimiter,
    createCountedTask,
    createControlledTask
} from '../common/test-utils.js';

describe('CapacityLimiter: Priority Handling', () => {
    let limiter: CapacityLimiter;

    beforeEach(() => {
        setupFakeTimers();
        limiter = createDefaultLimiter();
    });

    afterEach(() => {
        teardownFakeTimers();
    });

    it('should execute higher priority tasks before lower priority ones', async () => {
        const executionOrder: number[] = [];

        const fillTaskMock = createControlledTask();

        // Fill the capacity first to queue subsequent tasks
        const fillPromise = limiter.schedule(10, fillTaskMock.task);

        // Queue tasks with different priorities
        const lowPriorityTask = createCountedTask('low', executionOrder, 1);
        const mediumPriorityTask = createCountedTask('medium', executionOrder, 2);
        const highPriorityTask = createCountedTask('high', executionOrder, 3);

        // Schedule tasks with different priorities (default is 5)
        // Lower number = higher priority
        const lowPromise = limiter.schedule({
            task: lowPriorityTask,
            priority: 9,
            capacity: 5
        });

        const mediumPromise = limiter.schedule({
            task: mediumPriorityTask,
            priority: 5,
            capacity: 5
        });

        const highPromise = limiter.schedule({
            task: highPriorityTask,
            priority: 1,
            capacity: 5
        });

        // No tasks should be executed yet (all queued)
        expect(lowPriorityTask).toHaveBeenCalledTimes(0);
        expect(mediumPriorityTask).toHaveBeenCalledTimes(0);
        expect(highPriorityTask).toHaveBeenCalledTimes(0);

        // Now free up capacity
        fillTaskMock.resolve('done');
        await fillPromise;

        expect(highPriorityTask).toHaveBeenCalledTimes(1);
        expect(mediumPriorityTask).toHaveBeenCalledTimes(1);
        expect(lowPriorityTask).toHaveBeenCalledTimes(0);

        // High priority task should be executed first
        await Promise.all([highPromise, mediumPromise]);

        expect(highPriorityTask).toHaveBeenCalledTimes(1);
        expect(mediumPriorityTask).toHaveBeenCalledTimes(1);
        expect(lowPriorityTask).toHaveBeenCalledTimes(1);

        await lowPromise;

        // Check execution order
        expect(executionOrder).toEqual([3, 2, 1]);
    });

    it('should prioritize tasks with queueWaitingLimit that reach their time limit', async () => {
        const executionOrder: string[] = [];

        // Fill the capacity first
        const fillPromise = limiter.schedule(10, () => Promise.resolve());

        // Queue a regular task
        const regularTask = createCountedTask('regular result', executionOrder, 'regular');

        // Queue a task with time limit
        const timedTask = createCountedTask('timed result', executionOrder, 'timed');

        // Regular task with high priority
        const regularPromise = limiter.schedule({
            task: regularTask,
            priority: 1, // High priority
            capacity: 10
        });

        // Timed task with low priority but short waiting limit
        const timedPromise = limiter.schedule({
            task: timedTask,
            priority: 9, // Low priority
            capacity: 10,
            queueWaitingLimit: 100 // Very short waiting limit (100ms)
        });

        // No tasks executed yet
        expect(regularTask).toHaveBeenCalledTimes(0);
        expect(timedTask).toHaveBeenCalledTimes(0);

        // Advance time to exceed the waiting limit
        jest.advanceTimersByTime(110);

        await fillPromise;

        // Timed task should execute first despite lower priority
        // because it reached its queue waiting limit
        expect(timedTask).toHaveBeenCalledTimes(1);
        expect(regularTask).toHaveBeenCalledTimes(0);

        await timedPromise;

        // Regular task should execute second
        expect(regularTask).toHaveBeenCalledTimes(1);

        await regularPromise;

        // Check execution order - timed task first, then regular
        expect(executionOrder).toEqual(['timed', 'regular']);
    });

    it('should handle queue size exceeded with replace-by-priority strategy', async () => {
        limiter = new CapacityLimiter({
            maxCapacity: 10,
            maxQueueSize: 2,
            queueSizeExceededStrategy: 'replace-by-priority'
        });

        // Fill capacity so tasks will be queued
        const fillPromise = limiter.schedule(10, () => Promise.resolve());

        // Queue low priority task
        const lowPriorityTask = jest.fn().mockResolvedValue('low');
        const lowPromise = limiter.schedule({
            task: lowPriorityTask,
            priority: 9,
            capacity: 5
        });

        // Queue medium priority task
        const mediumPriorityTask = jest.fn().mockResolvedValue('medium');
        const mediumPromise = limiter.schedule({
            task: mediumPriorityTask,
            priority: 5,
            capacity: 5
        });

        // Queue should be full now with 2 tasks

        // Try to queue higher priority task - should replace low priority
        const highPriorityTask = jest.fn().mockResolvedValue('high');
        const highPromise = limiter.schedule({
            task: highPriorityTask,
            priority: 1,
            capacity: 5
        });

        // Low priority promise should be rejected due to replacement
        await expect(lowPromise).rejects.toThrow(CapacityLimiterError);
        expect(lowPriorityTask).toHaveBeenCalledTimes(0);

        await fillPromise;

        expect(highPriorityTask).toHaveBeenCalledTimes(1);

        // High priority should execute first
        await highPromise;

        expect(mediumPriorityTask).toHaveBeenCalledTimes(1);

        // Medium priority should execute second
        await mediumPromise;
    });

    it('should handle replace strategy for queue size exceeded', async () => {
        limiter = new CapacityLimiter({
            maxCapacity: 10,
            maxQueueSize: 2,
            queueSizeExceededStrategy: 'replace'
        });

        // Fill capacity so tasks will queue
        const fillPromise = limiter.schedule(10, () => Promise.resolve());

        // Queue two tasks
        const firstTask = jest.fn().mockResolvedValue('first');
        const firstPromise = limiter.schedule(5, firstTask);

        const secondTask = jest.fn().mockResolvedValue('second');
        const secondPromise = limiter.schedule(5, secondTask);

        // Try to queue a third task - should replace oldest (first)
        const thirdTask = jest.fn().mockResolvedValue('third');
        const thirdPromise = limiter.schedule(5, thirdTask);

        await fillPromise;

        // First task's promise should be rejected
        await Promise.all([
            expect(firstPromise).rejects.toThrow(CapacityLimiterError),
            expect(firstPromise).rejects.toMatchObject({
                type: 'queue-size-exceeded'
            })
        ]);

        expect(secondTask).toHaveBeenCalledTimes(1);

        // Second task should execute
        await secondPromise;

        expect(thirdTask).toHaveBeenCalledTimes(1);

        // Third task should execute
        await thirdPromise;
    });

    it('should throw when queue size is exceeded with throw-error strategy', async () => {
        limiter = new CapacityLimiter({
            maxCapacity: 10,
            maxQueueSize: 2,
            queueSizeExceededStrategy: 'throw-error'
        });

        // Fill capacity so tasks will queue
        const firstTaskPromise = limiter.schedule(10, () => Promise.resolve());

        // Queue two tasks (filling the queue)
        const queueTasksPromise = Promise.all([
            limiter.schedule(5, () => Promise.resolve('first')).catch(() => {}),
            limiter.schedule(5, () => Promise.resolve('second')).catch(() => {})
        ]);

        // Try to queue a third task - should throw immediately
        await Promise.all([
            expect(limiter.schedule(5, () => Promise.resolve('third'))).rejects.toThrow(CapacityLimiterError),
            expect(limiter.schedule(5, () => Promise.resolve('third'))).rejects.toMatchObject({
                type: 'queue-size-exceeded'
            })
        ]);

        await firstTaskPromise;
        await queueTasksPromise;
    });
});
