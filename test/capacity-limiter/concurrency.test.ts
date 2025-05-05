import {CapacityLimiter} from '../../src/index.js';
import {createControlledTask, createCountedTask} from '../common/test-utils.js';

describe('CapacityLimiter: Concurrency Limits', () => {
    it('should respect maxConcurrent limit', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            maxConcurrent: 2
        });

        const executionOrder: number[] = [];

        // Create tasks with controlled resolution
        const {task: task1, resolve: resolve1} = createControlledTask(executionOrder, 1);
        const {task: task2, resolve: resolve2} = createControlledTask(executionOrder, 2);
        const {task: task3, resolve: resolve3} = createControlledTask(executionOrder, 3);

        // Schedule 3 tasks but only 2 should run concurrently
        const promise1 = limiter.schedule(1, task1);
        const promise2 = limiter.schedule(1, task2);
        const promise3 = limiter.schedule(1, task3);

        // First two tasks should run, third should be queued
        expect(task1).toHaveBeenCalledTimes(1);
        expect(task2).toHaveBeenCalledTimes(1);
        expect(task3).toHaveBeenCalledTimes(0);

        // Complete the first task
        resolve1('result1');
        await promise1;

        // Third task should now start
        expect(task3).toHaveBeenCalledTimes(1);

        // Complete the remaining tasks
        resolve2('result2');
        resolve3('result3');

        const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

        expect(result1).toBe('result1');
        expect(result2).toBe('result2');
        expect(result3).toBe('result3');

        // Check execution order
        expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('should allow tasks with different capacities to run concurrently', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10
        });

        const executionOrder: number[] = [];

        // Create tasks with small capacity values
        const task1 = createCountedTask('result1', executionOrder, 1);
        const task2 = createCountedTask('result2', executionOrder, 2);
        const task3 = createCountedTask('result3', executionOrder, 3);

        // Schedule tasks with different capacities
        const promise1 = limiter.schedule(3, task1);
        const promise2 = limiter.schedule(4, task2);
        const promise3 = limiter.schedule(2, task3);

        // All tasks should fit within maxCapacity and run concurrently
        expect(task1).toHaveBeenCalledTimes(1);
        expect(task2).toHaveBeenCalledTimes(1);
        expect(task3).toHaveBeenCalledTimes(1);

        const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

        expect(result1).toBe('result1');
        expect(result2).toBe('result2');
        expect(result3).toBe('result3');
    });

    it('should handle maxConcurrent and maxCapacity limits together', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            maxConcurrent: 2
        });

        const executionOrder: number[] = [];

        // Create controlled tasks
        const {task: task1, resolve: resolve1} = createControlledTask(executionOrder, 1);
        const {task: task2, resolve: resolve2} = createControlledTask(executionOrder, 2);

        const task3 = createCountedTask('result3', executionOrder, 3);
        const task4 = createCountedTask('result4', executionOrder, 4);

        // Tasks 1 and 2 should run concurrently (maxConcurrent = 2)
        const promise1 = limiter.schedule(3, task1);
        const promise2 = limiter.schedule(3, task2);

        // Task 3 should queue due to maxConcurrent
        const promise3 = limiter.schedule(2, task3);

        // Task 4 should queue due to maxCapacity
        const promise4 = limiter.schedule(6, task4);

        // First two tasks should run
        expect(task1).toHaveBeenCalledTimes(1);
        expect(task2).toHaveBeenCalledTimes(1);
        expect(task3).toHaveBeenCalledTimes(0);
        expect(task4).toHaveBeenCalledTimes(0);

        // Complete first task
        resolve1('result1');
        await promise1;

        // Task 3 should now run (capacity allows and one concurrent slot freed)
        expect(task3).toHaveBeenCalledTimes(1);
        expect(task4).toHaveBeenCalledTimes(0); // Task 4 still queued

        // Complete second task
        resolve2('result2');
        await promise2;
        await promise3; // Task 3 should be done now

        // Task 4 should now run
        expect(task4).toHaveBeenCalledTimes(1);

        // Complete all
        const [result1, result2, result3, result4] = await Promise.all([promise1, promise2, promise3, promise4]);

        expect(result1).toBe('result1');
        expect(result2).toBe('result2');
        expect(result3).toBe('result3');
        expect(result4).toBe('result4');

        // Check execution order
        expect(executionOrder).toEqual([1, 2, 3, 4]);
    });

    it('should maintain capacity limits with claim strategy', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            capacityStrategy: 'claim'
        });

        // Schedule a task that takes 7 capacity
        await limiter.schedule(7, () => Promise.resolve('done'));

        // Try to schedule another task that needs 4 capacity (should be queued)
        const checkingTask = jest.fn().mockResolvedValue('checking');
        const checkingPromise = limiter.schedule(4, checkingTask);

        // The checking task should be queued, not executed due to claimed capacity
        expect(checkingTask).toHaveBeenCalledTimes(0);

        // With claim strategy, capacity should still be used after task completion
        expect(checkingTask).toHaveBeenCalledTimes(0);

        // Manually cancel the promise to avoid hanging test
        checkingPromise.catch(() => {});
    });

    it('should release capacity after task with reserve strategy', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            capacityStrategy: 'reserve'
        });

        const {task: mockTask, resolve: resolveTask} = createControlledTask();

        // Schedule a task that takes 7 capacity
        const promise = limiter.schedule(7, mockTask);

        // Task should be running
        expect(mockTask).toHaveBeenCalledTimes(1);

        // Try to schedule another task that needs 4 capacity (should be queued)
        const checkingTask = jest.fn().mockResolvedValue('checking');
        const checkingPromise = limiter.schedule(4, checkingTask);

        // The checking task should be queued, not executed
        expect(checkingTask).toHaveBeenCalledTimes(0);

        // Now complete the first task
        resolveTask('done');
        await promise;

        // After first task completes, capacity should be released
        // and the checking task should run
        expect(checkingTask).toHaveBeenCalledTimes(1);

        const result = await checkingPromise;
        expect(result).toBe('checking');
    });
});
