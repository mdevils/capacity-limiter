import {CapacityLimiter, CapacityLimiterError} from '../../src/index.js';
import {
    setupFakeTimers,
    teardownFakeTimers,
    createDefaultLimiter,
    createControlledTask,
    createCountedTask
} from '../common/test-utils.js';

/**
 * Tests for timeout-related behavior in the CapacityLimiter.
 * These tests focus on execution timeouts, queue waiting timeouts, and waiting limits.
 */
describe('CapacityLimiter: Timeout Handling', () => {
    let limiter: CapacityLimiter;

    beforeEach(() => {
        setupFakeTimers();
        limiter = createDefaultLimiter();
    });

    afterEach(() => {
        teardownFakeTimers();
    });

    describe('execution timeouts', () => {
        it('should timeout task execution when executionTimeout is reached', async () => {
            const {task: mockTask, resolve: resolveTask} = createControlledTask();

            // Schedule task with a 100ms execution timeout
            const promise = limiter.schedule({
                task: mockTask,
                capacity: 5,
                executionTimeout: 100
            });

            expect(mockTask).toHaveBeenCalledTimes(1);

            // Advance time to exceed the timeout
            jest.advanceTimersByTime(110);

            // Task should timeout
            await expect(promise).rejects.toThrow(CapacityLimiterError);
            await expect(promise).rejects.toMatchObject({
                type: 'execution-timeout',
                message: 'Task execution timeout.'
            });

            // Late resolution should have no effect
            resolveTask('too late');

            // Check that capacity was released
            expect(await limiter.getUsedCapacity()).toBe(0);
        });

        it('should use execution timeout from limiter options', async () => {
            // Set the execution timeout in the limiter options
            limiter.setOptions({
                ...limiter.getOptions(),
                executionTimeout: 100
            });

            // Create a task that never resolves
            const mockTask = jest.fn().mockImplementation(() => new Promise(() => {}));

            // Schedule task with default options (should use limiter's executionTimeout)
            const promise = limiter.schedule(5, mockTask);

            // Advance time to exceed the timeout
            jest.advanceTimersByTime(110);

            // Task should timeout
            await expect(promise).rejects.toThrow(CapacityLimiterError);
            await expect(promise).rejects.toMatchObject({
                type: 'execution-timeout'
            });
        });

        it('should properly clean up resources when a task times out', async () => {
            // Create a task that never resolves
            const mockTask = jest.fn().mockImplementation(() => new Promise(() => {}));

            // Schedule with short timeout
            const promise = limiter.schedule({
                task: mockTask,
                capacity: 8,
                executionTimeout: 100
            });

            // Advance time past timeout
            jest.advanceTimersByTime(110);

            // Wait for the promise to reject
            await expect(promise).rejects.toThrow(CapacityLimiterError);

            // Now we should be able to schedule a task that uses full capacity
            const successTask = jest.fn().mockResolvedValue('success');
            const successPromise = limiter.schedule(10, successTask);

            // If capacity was properly released, this task should run immediately
            expect(successTask).toHaveBeenCalledTimes(1);

            const result = await successPromise;
            expect(result).toBe('success');
        });

        it('should override limiter execution timeout with task-specific timeout', async () => {
            // Set the execution timeout in the limiter options
            limiter.setOptions({
                ...limiter.getOptions(),
                executionTimeout: 500
            });

            // Create a task that never resolves
            const mockTask = jest.fn().mockImplementation(() => new Promise(() => {}));

            // Schedule task with task-specific timeout that's shorter than the limiter timeout
            const promise = limiter.schedule({
                task: mockTask,
                capacity: 5,
                executionTimeout: 100 // This should override the 500ms from limiter options
            });

            // Advance time to exceed task-specific timeout but not limiter timeout
            jest.advanceTimersByTime(110);

            // Task should timeout based on its own timeout value
            await expect(promise).rejects.toThrow(CapacityLimiterError);
            await expect(promise).rejects.toMatchObject({
                type: 'execution-timeout'
            });
        });
    });

    describe('queue waiting timeouts', () => {
        it('should timeout tasks waiting in queue when queueWaitingTimeout is reached', async () => {
            // Fill the capacity first so tasks queue
            await limiter.schedule(10, () => Promise.resolve());

            // Queue a controlled task that fills capacity
            const longTaskMock = createControlledTask();
            const longTaskPromise = limiter.schedule({
                task: longTaskMock.task,
                capacity: 10
            });

            // Task should be executed immediately
            expect(longTaskMock.task).toHaveBeenCalledTimes(1);

            // Queue another task with a waiting timeout
            const waitingTaskMock = jest.fn().mockResolvedValue('result');
            const waitingTaskPromise = limiter.schedule({
                task: waitingTaskMock,
                capacity: 5,
                queueWaitingTimeout: 100
            });

            // Advance time to exceed the queue timeout
            jest.advanceTimersByTime(110);

            // Task should time out without executing
            expect(waitingTaskMock).toHaveBeenCalledTimes(0);
            await expect(waitingTaskPromise).rejects.toThrow(CapacityLimiterError);
            await expect(waitingTaskPromise).rejects.toMatchObject({
                type: 'queue-timeout',
                message: 'Task queue waiting timeout. Task was in the queue for 100ms.'
            });

            // Resolve the long task
            longTaskMock.resolve('done');
            await longTaskPromise;
        });

        it('should use default queueWaitingTimeout from limiter options', async () => {
            // Set the queue waiting timeout in the limiter options
            limiter.setOptions({
                ...limiter.getOptions(),
                queueWaitingTimeout: 100
            });

            // Fill the capacity first so tasks queue
            await limiter.schedule(10, () => Promise.resolve());

            // Queue a controlled task that fills capacity
            const longTaskMock = createControlledTask();
            const longTaskPromise = limiter.schedule({
                task: longTaskMock.task,
                capacity: 10
            });

            // Task should be executed immediately
            expect(longTaskMock.task).toHaveBeenCalledTimes(1);

            // Queue another task without specifying a waiting timeout
            // (should use the limiter's queueWaitingTimeout)
            const waitingTaskMock = jest.fn().mockResolvedValue('result');
            const waitingTaskPromise = limiter.schedule({
                task: waitingTaskMock,
                capacity: 5
            });

            // Advance time to exceed the queue timeout
            jest.advanceTimersByTime(110);

            // Task should time out without executing
            expect(waitingTaskMock).toHaveBeenCalledTimes(0);
            await expect(waitingTaskPromise).rejects.toThrow(CapacityLimiterError);
            await expect(waitingTaskPromise).rejects.toMatchObject({
                type: 'queue-timeout'
            });

            // Resolve the long task
            longTaskMock.resolve('done');
            await longTaskPromise;
        });

        it('should override limiter queue waiting timeout with task-specific timeout', async () => {
            // Set the queue waiting timeout in the limiter options
            limiter.setOptions({
                ...limiter.getOptions(),
                queueWaitingTimeout: 500
            });

            // Fill the capacity first so tasks queue
            await limiter.schedule(10, () => Promise.resolve());

            // Queue a controlled task that fills capacity
            const longTaskMock = createControlledTask();
            const longTaskPromise = limiter.schedule({
                task: longTaskMock.task,
                capacity: 10
            });

            // Queue another task with a shorter timeout than the limiter's
            const waitingTaskMock = jest.fn().mockResolvedValue('result');
            const waitingTaskPromise = limiter.schedule({
                task: waitingTaskMock,
                capacity: 5,
                queueWaitingTimeout: 100 // This should override the 500ms from limiter options
            });

            // Advance time to exceed the task-specific timeout but not the limiter timeout
            jest.advanceTimersByTime(110);

            // Task should time out based on its own timeout value
            expect(waitingTaskMock).toHaveBeenCalledTimes(0);
            await expect(waitingTaskPromise).rejects.toThrow(CapacityLimiterError);
            await expect(waitingTaskPromise).rejects.toMatchObject({
                type: 'queue-timeout'
            });

            // Resolve the long task
            longTaskMock.resolve('done');
            await longTaskPromise;
        });
    });

    describe('queue waiting limits', () => {
        it('should prioritize tasks with queueWaitingLimit over normal priority order', async () => {
            const executionOrder: number[] = [];

            // Fill capacity so tasks will queue
            const fillPromise = limiter.schedule(10, () => Promise.resolve('filled'));

            // Create high priority task
            const highPriorityTask = jest.fn().mockImplementation(() => {
                executionOrder.push(1);
                return Promise.resolve('high');
            });

            // Create low priority task with waiting limit
            const limitedTask = jest.fn().mockImplementation(() => {
                executionOrder.push(2);
                return Promise.resolve('limited');
            });

            // Schedule high priority task (no waiting limit)
            const highPromise = limiter.schedule({
                task: highPriorityTask,
                priority: 1, // High priority (0 is highest)
                capacity: 10
            });

            // Schedule low priority task with waiting limit
            const limitedPromise = limiter.schedule({
                task: limitedTask,
                priority: 8, // Low priority (9 is lowest)
                capacity: 10,
                queueWaitingLimit: 100
            });

            // No tasks should run yet (capacity is full)
            expect(highPriorityTask).toHaveBeenCalledTimes(0);
            expect(limitedTask).toHaveBeenCalledTimes(0);

            // Advance time to reach the waiting limit
            jest.advanceTimersByTime(110);

            // Now free up capacity
            await fillPromise;

            // Limited task should run first despite lower priority
            // because it exceeded its queue waiting limit
            expect(limitedTask).toHaveBeenCalledTimes(1);
            expect(highPriorityTask).toHaveBeenCalledTimes(0);

            // Complete limited task
            await limitedPromise;

            // Now high priority task should run
            expect(highPriorityTask).toHaveBeenCalledTimes(1);
            await highPromise;

            // Check execution order
            expect(executionOrder).toEqual([2, 1]);
        });

        it('should execute tasks that exceed queueWaitingLimit with highest priority', async () => {
            // Fill capacity with controlled task
            const fullCapacityTaskMock = createControlledTask();
            const fullCapacityPromise = limiter.schedule(10, fullCapacityTaskMock.task);

            const executionOrder: string[] = [];

            // Create tasks with different priorities
            const highTask = createCountedTask('high result', executionOrder, 'high');
            const mediumTask = createCountedTask('medium result', executionOrder, 'medium');
            const limitedTask = createCountedTask('limited result', executionOrder, 'limited');

            // Schedule high priority task
            const highPromise = limiter.schedule({
                task: highTask,
                priority: 1, // High priority
                capacity: 5
            });

            // Schedule medium priority task
            const mediumPromise = limiter.schedule({
                task: mediumTask,
                priority: 5, // Medium priority
                capacity: 5
            });

            // Schedule low priority task with waiting limit
            const limitedPromise = limiter.schedule({
                task: limitedTask,
                priority: 9, // Lowest priority
                capacity: 5,
                queueWaitingLimit: 50
            });

            // No tasks should execute yet (capacity is full)
            expect(highTask).toHaveBeenCalledTimes(0);
            expect(mediumTask).toHaveBeenCalledTimes(0);
            expect(limitedTask).toHaveBeenCalledTimes(0);

            // Advance time to exceed the waiting limit
            jest.advanceTimersByTime(60);

            // Free up capacity
            fullCapacityTaskMock.resolve('done');
            await fullCapacityPromise;

            // Limited task should run first despite having lowest priority
            expect(limitedTask).toHaveBeenCalledTimes(1);
            expect(highTask).toHaveBeenCalledTimes(1);
            expect(mediumTask).toHaveBeenCalledTimes(0);

            await limitedPromise;

            // High priority task should run next
            expect(highTask).toHaveBeenCalledTimes(1);
            expect(mediumTask).toHaveBeenCalledTimes(1);

            await Promise.all([highPromise, mediumPromise]);

            // Execution order should be: limited (due to waiting limit), then high, then medium
            expect(executionOrder).toEqual(['limited', 'high', 'medium']);
        });

        it('should use queueWaitingLimit from limiter options', async () => {
            // Set the queue waiting limit in the limiter options
            limiter.setOptions({
                ...limiter.getOptions(),
                queueWaitingLimit: 100
            });

            // Fill capacity
            await limiter.setUsedCapacity(10);

            const executionOrder: string[] = [];

            // Create low priority task (using limiter's queueWaitingLimit)
            const limitedTask1 = createCountedTask('limited result', executionOrder, 'limited 1');

            // Create low priority task (using own queueWaitingLimit)
            const limitedTask2 = createCountedTask('limited result', executionOrder, 'limited 2');

            // Create high priority task
            const highTask = createCountedTask('high result', executionOrder, 'high');

            // Schedule low priority task first
            const limitedPromise1 = limiter.schedule({
                task: limitedTask1,
                priority: 9,
                capacity: 10
                // Will use limiter's queueWaitingLimit of 100ms
            });

            // Schedule high priority task
            const highPromise = limiter.schedule({
                task: highTask,
                priority: 1,
                capacity: 10
                // Will use limiter's queueWaitingLimit of 100ms
            });

            // Schedule more limited low priority task
            const limitedPromise2 = limiter.schedule({
                task: limitedTask2,
                priority: 9,
                capacity: 10,
                queueWaitingLimit: 50
            });

            expect(limitedTask1).toHaveBeenCalledTimes(0);
            expect(highTask).toHaveBeenCalledTimes(0);
            expect(limitedTask2).toHaveBeenCalledTimes(0);

            // Advance time to exceed the waiting limit
            jest.advanceTimersByTime(110);

            // Free up capacity
            await limiter.setUsedCapacity(0);

            await Promise.all([limitedPromise1, limitedPromise2, highPromise]);

            // Check execution order
            expect(executionOrder).toEqual(['limited 2', 'limited 1', 'high']);
        });
    });
});
