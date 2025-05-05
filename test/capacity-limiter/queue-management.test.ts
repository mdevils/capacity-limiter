import {CapacityLimiter, CapacityLimiterError} from '../../src/index.js';
import {
    setupFakeTimers,
    teardownFakeTimers,
    createDefaultLimiter,
    createControlledTask,
    createCountedTask,
    fillLimiterToCapacity
} from '../common/test-utils.js';

/**
 * Tests for queue management functionality in CapacityLimiter.
 * These tests focus on queue size limits, queue overflow strategies, and queue behavior.
 */
describe('CapacityLimiter: Queue Management', () => {
    let limiter: CapacityLimiter;

    beforeEach(() => {
        setupFakeTimers();
        limiter = createDefaultLimiter();
    });

    afterEach(() => {
        teardownFakeTimers();
    });

    describe('queue size limits', () => {
        it('should respect maxQueueSize limit', async () => {
            // Create limiter with queue size limit
            limiter = createDefaultLimiter({
                maxQueueSize: 2
            });

            // Fill capacity to force queueing
            const {resolve: resolveFill, promise: fillPromise} = fillLimiterToCapacity(limiter);

            // Queue two tasks (filling the queue)
            const task1 = createCountedTask('result1');
            const task2 = createCountedTask('result2');
            const promise1 = limiter.schedule(5, task1);
            const promise2 = limiter.schedule(5, task2);

            // Verify queue is full but tasks haven't run
            expect(task1).toHaveBeenCalledTimes(0);
            expect(task2).toHaveBeenCalledTimes(0);

            // Default strategy is 'throw-error'
            // Try to queue a third task - should throw
            const task3 = createCountedTask('result3');
            await expect(limiter.schedule(5, task3)).rejects.toThrow(CapacityLimiterError);
            await expect(limiter.schedule(5, task3)).rejects.toMatchObject({
                type: 'queue-size-exceeded'
            });

            // Free capacity and verify original tasks execute
            resolveFill('done');
            await fillPromise;

            await promise1;
            await promise2;

            expect(task1).toHaveBeenCalledTimes(1);
            expect(task2).toHaveBeenCalledTimes(1);
        });

        it('should handle queue size exceeded with replace strategy', async () => {
            // Create limiter with replace strategy
            limiter = createDefaultLimiter({
                maxQueueSize: 2,
                queueSizeExceededStrategy: 'replace'
            });

            // Fill capacity to force queueing
            const {resolve: resolveFill, promise: fillPromise} = fillLimiterToCapacity(limiter);

            // Queue two tasks (filling the queue)
            const task1 = createCountedTask('result1');
            const task2 = createCountedTask('result2');
            const promise1 = limiter.schedule(5, task1);
            const promise2 = limiter.schedule(5, task2);

            // Try to queue a third task - should replace the oldest (first) task
            const task3 = createCountedTask('result3');
            const promise3 = limiter.schedule(5, task3);

            // First task's promise should be rejected
            await expect(promise1).rejects.toThrow(CapacityLimiterError);
            await expect(promise1).rejects.toMatchObject({
                type: 'queue-size-exceeded'
            });

            // Free capacity and verify tasks 2 and 3 execute
            resolveFill('done');
            await fillPromise;

            // Second task should run
            expect(task2).toHaveBeenCalledTimes(1);
            await promise2;

            // Third task should run
            expect(task3).toHaveBeenCalledTimes(1);
            await promise3;

            // First task should never run
            expect(task1).toHaveBeenCalledTimes(0);
        });

        it('should handle queue size exceeded with replace-by-priority strategy', async () => {
            // Create limiter with replace-by-priority strategy
            limiter = createDefaultLimiter({
                maxQueueSize: 2,
                queueSizeExceededStrategy: 'replace-by-priority'
            });

            // Fill capacity to force queueing
            const {resolve: resolveFill, promise: fillPromise} = fillLimiterToCapacity(limiter);

            // Queue low priority task
            const lowPriorityTask = jest.fn().mockResolvedValue('low');
            const lowPromise = limiter.schedule({
                task: lowPriorityTask,
                priority: 9, // Low priority
                capacity: 5
            });

            // Queue medium priority task
            const mediumPriorityTask = jest.fn().mockResolvedValue('medium');
            const mediumPromise = limiter.schedule({
                task: mediumPriorityTask,
                priority: 5, // Medium priority
                capacity: 5
            });

            // Queue should be full now with 2 tasks

            // Try to queue higher priority task - should replace low priority task
            const highPriorityTask = jest.fn().mockResolvedValue('high');
            const highPromise = limiter.schedule({
                task: highPriorityTask,
                priority: 1, // High priority
                capacity: 5
            });

            // Low priority promise should be rejected due to replacement
            await expect(lowPromise).rejects.toThrow(CapacityLimiterError);
            await expect(lowPromise).rejects.toMatchObject({
                type: 'queue-size-exceeded'
            });
            expect(lowPriorityTask).toHaveBeenCalledTimes(0);

            // Free capacity
            resolveFill('done');
            await fillPromise;

            // Higher priority task should execute first
            expect(highPriorityTask).toHaveBeenCalledTimes(1);
            await highPromise;

            // Medium priority task should execute second
            expect(mediumPriorityTask).toHaveBeenCalledTimes(1);
            await mediumPromise;
        });

        it('should not replace higher priority tasks with replace-by-priority strategy', async () => {
            // Create limiter with replace-by-priority strategy
            limiter = createDefaultLimiter({
                maxQueueSize: 2,
                queueSizeExceededStrategy: 'replace-by-priority'
            });

            // Fill capacity to force queueing
            const {resolve: resolveFill, promise: fillPromise} = fillLimiterToCapacity(limiter);

            // Queue high priority task
            const highPriorityTask = jest.fn().mockResolvedValue('high');
            const highPromise = limiter.schedule({
                task: highPriorityTask,
                priority: 1, // High priority
                capacity: 5
            });

            // Queue medium priority task
            const mediumPriorityTask = jest.fn().mockResolvedValue('medium');
            const mediumPromise = limiter.schedule({
                task: mediumPriorityTask,
                priority: 5, // Medium priority
                capacity: 5
            });

            // Queue should be full now with 2 tasks

            // Try to queue low priority task - should be rejected
            const lowPriorityTask = jest.fn().mockResolvedValue('low');
            const lowPromise = limiter.schedule({
                task: lowPriorityTask,
                priority: 9, // Low priority
                capacity: 5
            });

            // Low priority promise should be rejected
            await expect(lowPromise).rejects.toThrow(CapacityLimiterError);
            expect(lowPriorityTask).toHaveBeenCalledTimes(0);

            // Free capacity
            resolveFill('done');
            await fillPromise;

            // High priority task should execute
            expect(highPriorityTask).toHaveBeenCalledTimes(1);
            await highPromise;

            // Medium priority task should execute
            expect(mediumPriorityTask).toHaveBeenCalledTimes(1);
            await mediumPromise;
        });
    });

    describe('queue ordering', () => {
        it('should process tasks in priority order when freed', async () => {
            // Fill capacity to force queueing
            const {resolve: resolveFill, promise: fillPromise} = fillLimiterToCapacity(limiter);

            const executionOrder: string[] = [];

            // Queue tasks with different priorities
            const highTask = createCountedTask('high', executionOrder, 'high');
            const mediumTask = createCountedTask('medium', executionOrder, 'medium');
            const lowTask = createCountedTask('low', executionOrder, 'low');

            const highPromise = limiter.schedule({
                task: highTask,
                priority: 1, // High priority
                capacity: 5
            });

            const mediumPromise = limiter.schedule({
                task: mediumTask,
                priority: 5, // Medium priority
                capacity: 5
            });

            const lowPromise = limiter.schedule({
                task: lowTask,
                priority: 9, // Low priority
                capacity: 5
            });

            // Free capacity
            resolveFill('done');
            await fillPromise;

            // Tasks should execute in priority order
            await Promise.all([highPromise, mediumPromise, lowPromise]);

            expect(executionOrder).toEqual(['high', 'medium', 'low']);
        });

        it('should process tasks in FIFO order with same priority', async () => {
            // Fill capacity to force queueing
            const {resolve: resolveFill, promise: fillPromise} = fillLimiterToCapacity(limiter);

            const executionOrder: string[] = [];

            // Queue multiple tasks with same priority
            const task1 = createCountedTask('task1', executionOrder, 'task1');
            const task2 = createCountedTask('task2', executionOrder, 'task2');
            const task3 = createCountedTask('task3', executionOrder, 'task3');

            // All tasks have default priority (5)
            const promise1 = limiter.schedule(3, task1);
            const promise2 = limiter.schedule(3, task2);
            const promise3 = limiter.schedule(3, task3);

            // Free capacity
            resolveFill('done');
            await fillPromise;

            // Tasks should execute in FIFO order
            await Promise.all([promise1, promise2, promise3]);

            expect(executionOrder).toEqual(['task1', 'task2', 'task3']);
        });

        it('should process tasks based on capacity availability', async () => {
            // Fill capacity to force queueing
            const fillPromise = limiter.schedule(10, () => Promise.resolve('done'));

            const executionOrder: string[] = [];

            // Queue tasks with different capacities
            const smallTask = createCountedTask('small', executionOrder, 'small');
            const largeTask = createCountedTask('large', executionOrder, 'large');
            const mediumTask = createCountedTask('medium', executionOrder, 'medium');

            // All same priority, but different capacities
            const smallPromise = limiter.schedule(2, smallTask); // Small capacity
            const largePromise = limiter.schedule(9, largeTask); // Large capacity
            const mediumPromise = limiter.schedule(5, mediumTask); // Medium capacity

            expect(smallTask).toHaveBeenCalledTimes(0);
            expect(mediumTask).toHaveBeenCalledTimes(0);
            expect(largeTask).toHaveBeenCalledTimes(0);

            await fillPromise;

            expect(smallTask).toHaveBeenCalledTimes(1);
            expect(mediumTask).toHaveBeenCalledTimes(1);
            expect(largeTask).toHaveBeenCalledTimes(0);

            await Promise.all([smallPromise, mediumPromise]);

            // Large task should run now (needs 9 capacity)
            expect(largeTask).toHaveBeenCalledTimes(1);

            // All tasks should complete
            await largePromise;

            // Execution order should be by capacity availability
            expect(executionOrder).toEqual(['small', 'medium', 'large']);
        });
    });

    describe('stopping with queued tasks', () => {
        it('should stop and reject queued tasks when requested', async () => {
            // Fill capacity to force queueing
            const {resolve: resolveFill, promise: fillPromise} = fillLimiterToCapacity(limiter);

            // Queue several tasks
            const task1 = jest.fn().mockResolvedValue('task1');
            const task2 = jest.fn().mockResolvedValue('task2');
            const promise1 = limiter.schedule(5, task1);
            const promise2 = limiter.schedule(5, task2);

            // Stop limiter and reject waiting tasks
            const stopPromise = limiter.stop({stopWaitingTasks: true});

            // Tasks should be rejected
            await expect(promise1).rejects.toThrow(
                new CapacityLimiterError('stopped', 'Capacity limiter was stopped. Tasks were rejected.')
            );
            await expect(promise2).rejects.toThrow(
                new CapacityLimiterError('stopped', 'Capacity limiter was stopped. Tasks were rejected.')
            );

            // Tasks should never execute
            expect(task1).toHaveBeenCalledTimes(0);
            expect(task2).toHaveBeenCalledTimes(0);

            // Cleanup to avoid hanging test
            resolveFill('done');
            await fillPromise.catch(() => {});
            await stopPromise;
        });

        it('should stop and wait for executing tasks', async () => {
            // Create a controlled task
            const {task: controlledTask, resolve: resolveTask} = createControlledTask();

            // Schedule the task
            const taskPromise = limiter.schedule(5, controlledTask);

            // Task should be executing
            expect(controlledTask).toHaveBeenCalledTimes(1);

            // Start stopping the limiter but don't reject executing tasks
            const stopPromise = limiter.stop();

            // Stop promise should not resolve yet
            let stopResolved = false;
            stopPromise.then(() => {
                stopResolved = true;
            });

            // Verify stop hasn't completed
            expect(stopResolved).toBe(false);

            // Resolve the task
            resolveTask('done');
            await taskPromise;

            // Now stop should complete
            await stopPromise;
            expect(stopResolved).toBe(true);
        });

        it('should stop and reject executing tasks when requested', async () => {
            // Create a controlled task
            const {task: controlledTask} = createControlledTask();

            // Schedule the task
            const taskPromise = limiter.schedule(5, controlledTask);

            // Task should be executing
            expect(controlledTask).toHaveBeenCalledTimes(1);

            // Stop the limiter and reject executing tasks
            await limiter.stop({rejectExecutingTasks: true});

            // Task should be rejected
            await expect(taskPromise).rejects.toThrow(
                new CapacityLimiterError('stopped', 'Capacity limiter was stopped. Tasks were rejected.')
            );
        });
    });
});
