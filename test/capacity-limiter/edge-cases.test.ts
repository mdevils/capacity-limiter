import {CapacityLimiter, CapacityLimiterError} from '../../src/index.js';
import {setupFakeTimers, teardownFakeTimers} from '../common/test-utils.js';

describe('CapacityLimiter: Edge Cases', () => {
    beforeEach(() => {
        setupFakeTimers();
    });

    afterEach(() => {
        teardownFakeTimers();
    });

    it('should handle wait-for-full-capacity strategy', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            taskExceedsMaxCapacityStrategy: 'wait-for-full-capacity'
        });

        // First task takes 6 capacity
        const task1 = jest.fn().mockResolvedValue('result1');
        const promise1 = limiter.schedule(6, task1);

        // Task 1 should run immediately
        expect(task1).toHaveBeenCalledTimes(1);

        // A task that exceeds max capacity
        const largeTask = jest.fn().mockResolvedValue('large result');
        const largePromise = limiter.schedule(15, largeTask);

        // Large task should not run yet, as it must wait for empty capacity
        expect(largeTask).toHaveBeenCalledTimes(0);

        // Complete the first task
        await promise1;

        // Capacity is now 0, large task should run
        expect(largeTask).toHaveBeenCalledTimes(1);

        const result = await largePromise;
        expect(result).toBe('large result');
    });

    it('should execute task exceeding max capacity when current capacity is zero', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            taskExceedsMaxCapacityStrategy: 'wait-for-full-capacity'
        });

        // When capacity is zero, large tasks should be allowed in case of "wait-for-full-capacity" strategy
        const largeTask = jest.fn().mockResolvedValue('large result');
        const result = await limiter.schedule(15, largeTask);

        expect(largeTask).toHaveBeenCalledTimes(1);
        expect(result).toBe('large result');
    });

    it('should properly handle edge case with 0 capacity tasks', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10
        });

        // Fill up all capacity
        await limiter.schedule(10, () => Promise.resolve('full capacity'));

        // Schedule a task with 0 capacity
        const zeroCapacityTask = jest.fn().mockResolvedValue('zero capacity');
        const zeroPromise = limiter.schedule(0, zeroCapacityTask);

        // 0 capacity task should always run
        expect(zeroCapacityTask).toHaveBeenCalledTimes(1);

        const result = await zeroPromise;
        expect(result).toBe('zero capacity');
    });

    it('should handle multiple concurrent tasks with various parameters', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 20,
            maxConcurrent: 5
        });

        // Create a mix of different tasks
        const tasks = Array.from({length: 10}, (_, i) =>
            jest.fn().mockImplementation(() => Promise.resolve(`result-${i + 1}`))
        );

        // Schedule tasks with different capacities and priorities
        const promises = [
            limiter.schedule({task: tasks[0], capacity: 1, priority: 5}),
            limiter.schedule({task: tasks[1], capacity: 1, priority: 2}),
            limiter.schedule({task: tasks[2], capacity: 1, priority: 8}),
            limiter.schedule({task: tasks[3], capacity: 1, priority: 1}),
            limiter.schedule({task: tasks[4], capacity: 1, priority: 3}),
            limiter.schedule({task: tasks[5], capacity: 1, priority: 6}),
            limiter.schedule({task: tasks[6], capacity: 1, priority: 9}),
            limiter.schedule({task: tasks[7], capacity: 1, priority: 4}),
            limiter.schedule({task: tasks[8], capacity: 1, priority: 7}),
            limiter.schedule({task: tasks[9], capacity: 1, priority: 0})
        ];

        // First 5 tasks should execute (maxConcurrent = 5)
        expect(tasks[0]).toHaveBeenCalledTimes(1);
        expect(tasks[1]).toHaveBeenCalledTimes(1);
        expect(tasks[2]).toHaveBeenCalledTimes(1);
        expect(tasks[3]).toHaveBeenCalledTimes(1);
        expect(tasks[4]).toHaveBeenCalledTimes(1);

        // Rest should be queued
        expect(tasks[5]).toHaveBeenCalledTimes(0);
        expect(tasks[6]).toHaveBeenCalledTimes(0);
        expect(tasks[7]).toHaveBeenCalledTimes(0);
        expect(tasks[8]).toHaveBeenCalledTimes(0);
        expect(tasks[9]).toHaveBeenCalledTimes(0);

        // Resolve all promises
        const results = await Promise.all(promises);

        // All tasks should have run
        tasks.forEach((task, i) => {
            expect(task).toHaveBeenCalledTimes(1);
            expect(results[i]).toBe(`result-${i + 1}`);
        });
    });

    it('should handle cancellation of queued tasks', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10
        });

        // Fill capacity
        await limiter.schedule(10, () => Promise.resolve());

        // Queue several tasks but intentionally reject their promises externally
        let reject: (error: unknown) => void;
        const task = jest.fn().mockImplementation(() => new Promise((_, rej) => (reject = rej)));

        const promise = limiter.schedule(5, task);

        reject!(new Error('Task cancelled'));

        await expect(promise).rejects.toThrow();

        // Verify a new task can execute
        const newTask = jest.fn().mockResolvedValue('new task');
        const newPromise = limiter.schedule(5, newTask);

        expect(newTask).toHaveBeenCalledTimes(1);
        await newPromise;
    });

    it('should handle tasks with decimal capacity values', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10
        });

        // Schedule tasks with decimal capacities
        const task1 = jest.fn().mockResolvedValue('task1');
        const task2 = jest.fn().mockResolvedValue('task2');
        const task3 = jest.fn().mockResolvedValue('task3');

        // These should collectively use: 3.5 + 2.75 + 3.75 = 10 capacity
        const promise1 = limiter.schedule(3.5, task1);
        const promise2 = limiter.schedule(2.75, task2);
        const promise3 = limiter.schedule(3.75, task3);

        // All three should execute
        expect(task1).toHaveBeenCalledTimes(1);
        expect(task2).toHaveBeenCalledTimes(1);
        expect(task3).toHaveBeenCalledTimes(1);

        // But a 4th task should be queued
        const task4 = jest.fn().mockResolvedValue('task4');
        const promise4 = limiter.schedule(0.1, task4);

        expect(task4).toHaveBeenCalledTimes(0);

        // After completing the tasks, the 4th should run
        await Promise.all([promise1, promise2, promise3]);
        jest.runAllTimers();

        expect(task4).toHaveBeenCalledTimes(1);
        await promise4;
    });

    it('should handle very large number of queued tasks', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 1
        });

        // Fill capacity
        const firstPromise = limiter.schedule(1, () => Promise.resolve());

        // Queue a large number of tasks
        const taskCount = 100;
        const tasks = Array.from({length: taskCount}, (_, i) => jest.fn().mockResolvedValue(`result-${i}`));

        const promises = tasks.map((task, i) =>
            limiter.schedule({
                task,
                capacity: 1,
                priority: i % 10 // Mix of priorities
            })
        );

        // None should execute initially
        tasks.forEach((task) => expect(task).toHaveBeenCalledTimes(0));

        // Free up capacity
        await firstPromise;

        expect(tasks[0]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[5]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[9]).toHaveBeenCalledTimes(0); // Priority 9
        expect(tasks[10]).toHaveBeenCalledTimes(0); // Priority 0
        expect(tasks[15]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[19]).toHaveBeenCalledTimes(0); // Priority 9
        expect(tasks[20]).toHaveBeenCalledTimes(0); // Priority 0
        expect(tasks[25]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[29]).toHaveBeenCalledTimes(0); // Priority 9

        await promises[0];

        expect(tasks[0]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[5]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[9]).toHaveBeenCalledTimes(0); // Priority 9
        expect(tasks[10]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[15]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[19]).toHaveBeenCalledTimes(0); // Priority 9
        expect(tasks[20]).toHaveBeenCalledTimes(0); // Priority 0
        expect(tasks[25]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[29]).toHaveBeenCalledTimes(0); // Priority 9

        await promises[10];

        expect(tasks[0]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[5]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[9]).toHaveBeenCalledTimes(0); // Priority 9
        expect(tasks[10]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[15]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[19]).toHaveBeenCalledTimes(0); // Priority 9
        expect(tasks[20]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[25]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[29]).toHaveBeenCalledTimes(0); // Priority 9

        await promises[5];

        expect(tasks[0]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[5]).toHaveBeenCalledTimes(1); // Priority 5
        expect(tasks[9]).toHaveBeenCalledTimes(0); // Priority 9
        expect(tasks[10]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[15]).toHaveBeenCalledTimes(1); // Priority 5
        expect(tasks[19]).toHaveBeenCalledTimes(0); // Priority 9
        expect(tasks[20]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[25]).toHaveBeenCalledTimes(0); // Priority 5
        expect(tasks[29]).toHaveBeenCalledTimes(0); // Priority 9

        await promises[9];

        expect(tasks[0]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[5]).toHaveBeenCalledTimes(1); // Priority 5
        expect(tasks[9]).toHaveBeenCalledTimes(1); // Priority 9
        expect(tasks[10]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[15]).toHaveBeenCalledTimes(1); // Priority 5
        expect(tasks[19]).toHaveBeenCalledTimes(1); // Priority 9
        expect(tasks[20]).toHaveBeenCalledTimes(1); // Priority 0
        expect(tasks[25]).toHaveBeenCalledTimes(1); // Priority 5
        expect(tasks[29]).toHaveBeenCalledTimes(0); // Priority 9

        // Complete all tasks
        for (let i = 0; i < taskCount - 1; i++) {
            limiter.schedule(0, () => Promise.resolve());
            jest.runAllTimers();
        }

        // All tasks should eventually execute
        const results = await Promise.all(promises);
        tasks.forEach((task, i) => {
            expect(task).toHaveBeenCalledTimes(1);
            expect(results[i]).toBe(`result-${i}`);
        });
    });

    it('should handle edge case of 0 maxCapacity', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 0, // Unusual but possible edge case
            taskExceedsMaxCapacityStrategy: 'throw-error'
        });

        // Schedule a task with zero capacity
        const zeroTask = jest.fn().mockResolvedValue('zero task');
        const firstPromise = limiter.schedule(0, zeroTask);

        // Zero capacity task should run even with zero max capacity
        expect(zeroTask).toHaveBeenCalledTimes(1);

        await firstPromise;

        // But a task with any capacity should fail
        const normalTask = jest.fn().mockResolvedValue('normal task');
        expect(() => limiter.schedule(1, normalTask)).toThrow(
            new CapacityLimiterError('max-capacity-exceeded', 'Task capacity (1) exceeds maxCapacity (0).')
        );

        limiter.setOptions({...limiter.getOptions(), taskExceedsMaxCapacityStrategy: 'wait-for-full-capacity'});

        // Now a task with any capacity should be allowed
        const normalPromise = limiter.schedule(1, normalTask);
        expect(normalTask).toHaveBeenCalledTimes(1);
        await normalPromise;
    });
});
