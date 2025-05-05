import {CapacityLimiter} from '../../src/index.js';
import {
    createDefaultLimiter,
    createCountedTask,
    createFailingTask,
    createControlledTask
} from '../common/test-utils.js';

/**
 * Tests for the core functionality of the CapacityLimiter.
 * These tests focus on the basic scheduling behavior and task execution.
 */
describe('CapacityLimiter: Basic Functionality', () => {
    let limiter: CapacityLimiter;

    beforeEach(() => {
        limiter = createDefaultLimiter();
    });

    describe('task execution', () => {
        it('should execute tasks immediately when capacity allows', async () => {
            const mockCallback = jest.fn().mockResolvedValue('result');
            const promise = limiter.schedule(5, mockCallback);

            expect(mockCallback).toHaveBeenCalledTimes(1);
            const result = await promise;
            expect(result).toBe('result');
        });

        it('should execute multiple tasks concurrently when capacity allows', async () => {
            const task1 = jest.fn().mockResolvedValue('result1');
            const task2 = jest.fn().mockResolvedValue('result2');
            const task3 = jest.fn().mockResolvedValue('result3');

            // Each task uses 3 capacity, total of 9, which fits within max capacity of 10
            const promise1 = limiter.schedule(3, task1);
            const promise2 = limiter.schedule(3, task2);
            const promise3 = limiter.schedule(3, task3);

            // All tasks should execute immediately
            expect(task1).toHaveBeenCalledTimes(1);
            expect(task2).toHaveBeenCalledTimes(1);
            expect(task3).toHaveBeenCalledTimes(1);

            const results = await Promise.all([promise1, promise2, promise3]);
            expect(results).toEqual(['result1', 'result2', 'result3']);
        });

        it('should return the resolved value from scheduled tasks', async () => {
            const result1 = await limiter.schedule(() => Promise.resolve('simple result'));
            expect(result1).toBe('simple result');

            const result2 = await limiter.schedule(5, () => Promise.resolve('result with capacity'));
            expect(result2).toBe('result with capacity');

            const complexResult = {data: 'complex object', status: 'success'};
            const result3 = await limiter.schedule(() => Promise.resolve(complexResult));
            expect(result3).toEqual(complexResult);
        });

        it('should handle resolved and rejected promises correctly', async () => {
            // Successful task
            const successTask = jest.fn().mockResolvedValue('success');
            const successPromise = limiter.schedule(2, successTask);

            // Failing task
            const error = new Error('Task failed');
            const failingTask = createFailingTask(error);
            const failingPromise = limiter.schedule(2, failingTask);

            // Verify promises resolve/reject correctly
            await expect(successPromise).resolves.toBe('success');
            await expect(failingPromise).rejects.toThrow('Task failed');
        });
    });

    describe('task queuing', () => {
        it('should queue tasks when capacity is exceeded', async () => {
            const executionOrder: number[] = [];

            const task1 = createCountedTask('result1', executionOrder, 1);
            const task2 = createCountedTask('result2', executionOrder, 2);
            const task3 = createCountedTask('result3', executionOrder, 3);

            // First task takes 6 capacity
            const promise1 = limiter.schedule(6, task1);
            // Second task takes 6 capacity, exceeding the maximum of 10, should be queued
            const promise2 = limiter.schedule(6, task2);
            // Third task takes 2 capacity, should run immediately as it fits
            const promise3 = limiter.schedule(2, task3);

            // First and third tasks should run immediately
            expect(task1).toHaveBeenCalledTimes(1);
            expect(task2).toHaveBeenCalledTimes(0);
            expect(task3).toHaveBeenCalledTimes(1);

            // Resolve the first task to make room for the second
            await promise1;

            // Second task should now be executed
            expect(task2).toHaveBeenCalledTimes(1);

            const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

            expect(result1).toBe('result1');
            expect(result2).toBe('result2');
            expect(result3).toBe('result3');

            // First and third task should be executed before the second
            expect(executionOrder).toEqual([1, 3, 2]);
        });

        it('should execute tasks in order of availability when capacity is freed', async () => {
            // Fill up the capacity first
            const {task: fillTask, resolve: resolveFill} = createControlledTask();
            const fillPromise = limiter.schedule(10, fillTask);

            const executionOrder: string[] = [];

            // Queue several tasks
            const task1 = createCountedTask('result1', executionOrder, 'task1');
            const task2 = createCountedTask('result2', executionOrder, 'task2');
            const task3 = createCountedTask('result3', executionOrder, 'task3');

            // All tasks should be queued since capacity is full
            const promise1 = limiter.schedule(3, task1);
            const promise2 = limiter.schedule(5, task2);
            const promise3 = limiter.schedule(2, task3);

            expect(task1).toHaveBeenCalledTimes(0);
            expect(task2).toHaveBeenCalledTimes(0);
            expect(task3).toHaveBeenCalledTimes(0);

            // Now free up the capacity
            resolveFill('fill done');
            await fillPromise;

            // Now all tasks can run since there's enough capacity
            const results = await Promise.all([promise1, promise2, promise3]);

            // All tasks should have run
            expect(task1).toHaveBeenCalledTimes(1);
            expect(task2).toHaveBeenCalledTimes(1);
            expect(task3).toHaveBeenCalledTimes(1);

            // Results should be correct
            expect(results).toEqual(['result1', 'result2', 'result3']);

            // Tasks should be executed in order of scheduling
            expect(executionOrder).toEqual(['task1', 'task2', 'task3']);
        });
    });

    describe('schedule() method signatures', () => {
        it('should support function with default capacity', async () => {
            const result = await limiter.schedule(() => Promise.resolve('result'));
            expect(result).toBe('result');
        });

        it('should support function with specified capacity', async () => {
            const result = await limiter.schedule(3, () => Promise.resolve('result'));
            expect(result).toBe('result');
        });

        it('should support object-style configuration', async () => {
            const result = await limiter.schedule({
                task: () => Promise.resolve('result'),
                capacity: 5
            });
            expect(result).toBe('result');
        });

        it('should support object-style with priority', async () => {
            const result = await limiter.schedule({
                task: () => Promise.resolve('result'),
                capacity: 5,
                priority: 3
            });
            expect(result).toBe('result');
        });

        it('should support object-style with full configuration', async () => {
            const result = await limiter.schedule({
                task: () => Promise.resolve('result'),
                capacity: 5,
                priority: 3,
                queueWaitingLimit: 1000,
                queueWaitingTimeout: 2000,
                executionTimeout: 3000
            });
            expect(result).toBe('result');
        });
    });

    describe('capacity management strategies', () => {
        it('should use reserve strategy by default', async () => {
            const executionOrder: string[] = [];

            const {task: task1, resolve: resolve1} = createControlledTask(executionOrder, 'task1');
            const task2 = createCountedTask('result2', executionOrder, 'task2');

            // First task takes 8 capacity
            const promise1 = limiter.schedule(8, task1);
            // Second task takes 3 capacity, should be queued
            const promise2 = limiter.schedule(3, task2);

            expect(task1).toHaveBeenCalledTimes(1);
            expect(task2).toHaveBeenCalledTimes(0);

            // Resolve first task - should free capacity
            resolve1('result1');
            await promise1;

            // Second task should now run
            expect(task2).toHaveBeenCalledTimes(1);

            const result2 = await promise2;
            expect(result2).toBe('result2');

            // Tasks executed in order
            expect(executionOrder).toEqual(['task1', 'task2']);
        });

        it('should keep capacity used with claim strategy', async () => {
            // Create limiter with claim strategy
            limiter = createDefaultLimiter({capacityStrategy: 'claim'});

            const executionOrder: string[] = [];

            const task1 = createCountedTask('result1', executionOrder, 'task1');
            const task2 = createCountedTask('result2', executionOrder, 'task2');

            // First task takes 8 capacity
            const promise1 = limiter.schedule(8, task1);
            // Second task takes 3 capacity, should be queued
            const promise2 = limiter.schedule(3, task2);

            expect(task1).toHaveBeenCalledTimes(1);
            expect(task2).toHaveBeenCalledTimes(0);

            // Complete first task - capacity should remain used
            await promise1;

            // Second task should still be queued
            expect(task2).toHaveBeenCalledTimes(0);

            // We need to manually free capacity
            await limiter.setUsedCapacity(0);

            // Now second task should run
            expect(task2).toHaveBeenCalledTimes(1);

            await promise2;
        });

        it('should allow a task with capacity exceeding max in case of wait-for-full-capacity strategy', async () => {
            limiter.setOptions({
                ...limiter.getOptions(),
                taskExceedsMaxCapacityStrategy: 'wait-for-full-capacity'
            });

            // Create a task that exceeds max capacity
            const largeTask = jest.fn().mockResolvedValue('large result');

            // Schedule the task with capacity > maxCapacity (10)
            const result = await limiter.schedule(15, largeTask);

            // Task should be executed anyway when starting from zero capacity
            expect(largeTask).toHaveBeenCalledTimes(1);
            expect(result).toBe('large result');
        });
    });
});
