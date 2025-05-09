import {CapacityLimiter} from '../../src/index.js';
import {setupFakeTimers, teardownFakeTimers, createDefaultLimiter, createCountedTask} from '../common/test-utils.js';

/**
 * Tests for the minDelayBetweenTasks feature of the CapacityLimiter.
 * These tests focus on ensuring that tasks are executed with the specified minimum delay between them.
 */
describe('CapacityLimiter: Min Delay Between Tasks', () => {
    let limiter: CapacityLimiter;

    beforeEach(() => {
        setupFakeTimers();
    });

    afterEach(() => {
        teardownFakeTimers();
    });

    describe('task scheduling with delays', () => {
        it('should enforce a minimum delay between task executions', async () => {
            // Create limiter with minDelayBetweenTasks set to 100ms
            limiter = createDefaultLimiter({
                minDelayBetweenTasks: 100
            });

            const executionOrder: number[] = [];
            const executionTimes: number[] = [];

            // Create tasks that record their execution time
            const task1 = jest.fn().mockImplementation(() => {
                executionOrder.push(1);
                executionTimes.push(Date.now());
                return Promise.resolve('result1');
            });

            const task2 = jest.fn().mockImplementation(() => {
                executionOrder.push(2);
                executionTimes.push(Date.now());
                return Promise.resolve('result2');
            });

            const task3 = jest.fn().mockImplementation(() => {
                executionOrder.push(3);
                executionTimes.push(Date.now());
                return Promise.resolve('result3');
            });

            // Schedule tasks
            const promise1 = limiter.schedule(task1);
            const promise2 = limiter.schedule(task2);
            const promise3 = limiter.schedule(task3);

            // First task should execute immediately
            expect(task1).toHaveBeenCalledTimes(1);
            // Second and third tasks should not execute yet
            expect(task2).toHaveBeenCalledTimes(0);
            expect(task3).toHaveBeenCalledTimes(0);

            // Advance time by 50ms (less than minDelayBetweenTasks)
            jest.advanceTimersByTime(50);

            // Second task still should not execute
            expect(task2).toHaveBeenCalledTimes(0);

            // Advance time to reach minDelayBetweenTasks
            jest.advanceTimersByTime(50);

            // Second task should now execute
            expect(task2).toHaveBeenCalledTimes(1);
            // Third task still should not execute
            expect(task3).toHaveBeenCalledTimes(0);

            // Advance time for the third task
            jest.advanceTimersByTime(99);

            // Third task should now execute
            expect(task3).toHaveBeenCalledTimes(0);

            // Advance time for the third task
            jest.advanceTimersByTime(1);

            // Third task should now execute
            expect(task3).toHaveBeenCalledTimes(1);

            // Wait for all promises to resolve
            const results = await Promise.all([promise1, promise2, promise3]);

            expect(results).toEqual(['result1', 'result2', 'result3']);
            expect(executionOrder).toEqual([1, 2, 3]);

            // Verify that the time between executions is at least minDelayBetweenTasks
            expect(executionTimes[1] - executionTimes[0]).toBeGreaterThanOrEqual(100);
            expect(executionTimes[2] - executionTimes[1]).toBeGreaterThanOrEqual(100);
        });

        it('should apply minDelayBetweenTasks between successful and failed task executions', async () => {
            limiter = createDefaultLimiter({
                minDelayBetweenTasks: 100
            });

            const executionOrder: number[] = [];

            // Create a successful task
            const task1 = jest.fn().mockImplementation(() => {
                executionOrder.push(1);
                return Promise.resolve('result1');
            });

            // Create a task that will throw an error
            const taskError = jest.fn().mockImplementation(() => {
                executionOrder.push(2);
                return Promise.reject(new Error('Task failed'));
            });

            // Create another successful task
            const task3 = jest.fn().mockImplementation(() => {
                executionOrder.push(3);
                return Promise.resolve('result3');
            });

            // Schedule tasks
            const promise1 = limiter.schedule(task1);
            const promiseError = limiter.schedule(taskError).catch(() => 'error handled');
            const promise3 = limiter.schedule(task3);

            // First task should execute immediately
            expect(task1).toHaveBeenCalledTimes(1);

            // Advance time to reach minDelayBetweenTasks
            jest.advanceTimersByTime(100);

            // Error task should now execute
            expect(taskError).toHaveBeenCalledTimes(1);

            // Wait for error task promise to be handled
            await promiseError;

            // Third task should not execute yet due to minDelayBetweenTasks
            expect(task3).toHaveBeenCalledTimes(0);

            // Advance time for the third task
            jest.advanceTimersByTime(100);

            // Third task should now execute
            expect(task3).toHaveBeenCalledTimes(1);

            // Wait for all promises to resolve
            await Promise.all([promise1, promise3]);

            expect(executionOrder).toEqual([1, 2, 3]);
        });

        it('should enforce delays when tasks free up capacity for queued tasks', async () => {
            limiter = createDefaultLimiter({
                minDelayBetweenTasks: 100
            });

            const executionOrder: string[] = [];

            // Fill up the capacity first
            const fillTask = jest.fn().mockImplementation(() => {
                executionOrder.push('fill');
                return Promise.resolve('fill done');
            });
            const fillPromise = limiter.schedule(10, fillTask);

            // Queue tasks that will execute once capacity is freed
            const task1 = createCountedTask('result1', executionOrder, 'task1');
            const task2 = createCountedTask('result2', executionOrder, 'task2');
            const task3 = createCountedTask('result3', executionOrder, 'task3');

            const promise1 = limiter.schedule(3, task1);
            const promise2 = limiter.schedule(3, task2);
            const promise3 = limiter.schedule(3, task3);

            // Fill task executes, others should be queued
            expect(fillTask).toHaveBeenCalledTimes(1);
            expect(task1).toHaveBeenCalledTimes(0);
            expect(task2).toHaveBeenCalledTimes(0);
            expect(task3).toHaveBeenCalledTimes(0);

            // Resolve the fill task to free up capacity
            await fillPromise;

            // Advance time to run the first queued task
            jest.advanceTimersByTime(100);

            // First queued task should run immediately
            expect(task1).toHaveBeenCalledTimes(1);
            expect(task2).toHaveBeenCalledTimes(0);
            expect(task3).toHaveBeenCalledTimes(0);

            // Advance time to just before the delay completes
            jest.advanceTimersByTime(99);

            // Second task should not run yet
            expect(task2).toHaveBeenCalledTimes(0);

            // Advance time to complete the delay
            jest.advanceTimersByTime(1);

            // Second task should now run
            expect(task2).toHaveBeenCalledTimes(1);
            expect(task3).toHaveBeenCalledTimes(0);

            // Advance time for third task
            jest.advanceTimersByTime(100);

            // Third task should now run
            expect(task3).toHaveBeenCalledTimes(1);

            // Wait for all promises to resolve
            await Promise.all([promise1, promise2, promise3]);

            // Tasks should execute in order with the specified delay
            expect(executionOrder).toEqual(['fill', 'task1', 'task2', 'task3']);
        });
    });

    describe('limiter options handling', () => {
        it('should accept setting minDelayBetweenTasks via constructor options', () => {
            // No error should be thrown
            limiter = new CapacityLimiter({
                maxCapacity: 10,
                minDelayBetweenTasks: 100
            });

            expect(limiter.getOptions().minDelayBetweenTasks).toBe(100);
        });

        it('should accept updating minDelayBetweenTasks via setOptions', () => {
            limiter = createDefaultLimiter();

            expect(limiter.getOptions().minDelayBetweenTasks).toBeUndefined();

            limiter.setOptions({
                ...limiter.getOptions(),
                minDelayBetweenTasks: 200
            });

            expect(limiter.getOptions().minDelayBetweenTasks).toBe(200);
        });

        it('should reject negative values for minDelayBetweenTasks', () => {
            expect(() => {
                new CapacityLimiter({
                    maxCapacity: 10,
                    minDelayBetweenTasks: -100
                });
            }).toThrow('Invalid argument. Expected a non-negative number as the minDelayBetweenTasks.');
        });

        it('should allow zero as a valid value for minDelayBetweenTasks', () => {
            // No error should be thrown, zero is valid (no delay)
            limiter = new CapacityLimiter({
                maxCapacity: 10,
                minDelayBetweenTasks: 0
            });

            expect(limiter.getOptions().minDelayBetweenTasks).toBe(0);
        });
    });

    describe('interaction with other features', () => {
        it('should allow long-running tasks to overlap without maxConcurrent', async () => {
            // Test without maxConcurrent
            limiter = createDefaultLimiter({
                minDelayBetweenTasks: 100
            });

            const startTimes: number[] = [];
            const endTimes: number[] = [];

            // Create long-running tasks
            const longTask1 = jest.fn().mockImplementation(() => {
                startTimes.push(Date.now());
                return new Promise((resolve) => {
                    setTimeout(() => {
                        endTimes.push(Date.now());
                        resolve('result1');
                    }, 300);
                });
            });

            const longTask2 = jest.fn().mockImplementation(() => {
                startTimes.push(Date.now());
                return new Promise((resolve) => {
                    setTimeout(() => {
                        endTimes.push(Date.now());
                        resolve('result2');
                    }, 300);
                });
            });

            // Reset timer for clean test
            jest.setSystemTime(0);

            // Schedule tasks
            const promise1 = limiter.schedule(longTask1);

            // First task should execute immediately
            expect(longTask1).toHaveBeenCalledTimes(1);

            // Advance time to reach minDelayBetweenTasks
            jest.advanceTimersByTime(100);

            // Schedule second task
            const promise2 = limiter.schedule(longTask2);

            // Second task should also execute now, even though first task is still running
            expect(longTask2).toHaveBeenCalledTimes(1);

            // Advance time to complete both tasks
            jest.advanceTimersByTime(300);

            // Wait for promises to resolve
            await Promise.all([promise1, promise2]);

            // Verify that tasks were executed with correct timing
            // First task should start at time 0
            expect(startTimes[0]).toBe(0);
            // Second task should start after minDelayBetweenTasks (100ms)
            expect(startTimes[1]).toBe(100);

            // Both tasks should complete after their durations
            expect(endTimes[0]).toBe(300);
            expect(endTimes[1]).toBe(400);

            // The key point: the second task starts before the first task ends
            expect(startTimes[1]).toBeLessThan(endTimes[0]);
        });

        it('should prevent task overlap with maxConcurrent=1 and minDelayBetweenTasks', async () => {
            // Test with maxConcurrent=1
            limiter = createDefaultLimiter({
                minDelayBetweenTasks: 100,
                maxConcurrent: 1
            });

            const startTimes: number[] = [];
            const endTimes: number[] = [];

            // Create tasks
            const task1 = jest.fn().mockImplementation(() => {
                startTimes.push(Date.now());
                return new Promise((resolve) => {
                    setTimeout(() => {
                        endTimes.push(Date.now());
                        resolve('result1');
                    }, 300);
                });
            });

            const task2 = jest.fn().mockImplementation(() => {
                startTimes.push(Date.now());
                return new Promise((resolve) => {
                    setTimeout(() => {
                        endTimes.push(Date.now());
                        resolve('result2');
                    }, 200);
                });
            });

            // Reset timer for clean test
            jest.setSystemTime(0);

            // Schedule tasks
            const promise1 = limiter.schedule(task1);
            const promise2 = limiter.schedule(task2);

            // First task should execute immediately
            expect(task1).toHaveBeenCalledTimes(1);
            // Second task should not execute yet due to maxConcurrent=1
            expect(task2).toHaveBeenCalledTimes(0);

            // Advance time to complete first task
            jest.advanceTimersByTime(300);
            await Promise.resolve(); // Allow task to resolve

            // Need to advance time for minDelayBetweenTasks
            jest.advanceTimersByTime(100);

            // Now second task should execute
            expect(task2).toHaveBeenCalledTimes(1);

            // Advance time to complete second task
            jest.advanceTimersByTime(200);

            // Wait for promises to resolve
            await Promise.all([promise1, promise2]);

            // Verify that tasks were executed with correct timing
            // First task should start at time 0
            expect(startTimes[0]).toBe(0);
            // First task should end at time 300
            expect(endTimes[0]).toBe(300);

            // Second task should start after first task finishes
            expect(startTimes[1]).toBe(300);
            // Second task should end after its duration (200ms)
            expect(endTimes[1]).toBe(500);

            // The key point: the second task starts after the first task
            expect(startTimes[1]).toBeGreaterThanOrEqual(endTimes[0]);
        });

        it('should work correctly with priority handling', async () => {
            limiter = createDefaultLimiter({
                minDelayBetweenTasks: 100
            });

            const executionOrder: string[] = [];

            // Create tasks with different priorities
            const highPriorityTask = jest.fn().mockImplementation(() => {
                executionOrder.push('high');
                return Promise.resolve('high result');
            });

            const mediumPriorityTask = jest.fn().mockImplementation(() => {
                executionOrder.push('medium');
                return Promise.resolve('medium result');
            });

            const lowPriorityTask = jest.fn().mockImplementation(() => {
                executionOrder.push('low');
                return Promise.resolve('low result');
            });

            // Fill capacity first
            const fillPromise = limiter.schedule(10, () => Promise.resolve());

            // Queue tasks with different priorities
            const lowPromise = limiter.schedule({
                task: lowPriorityTask,
                priority: 9, // Low priority
                capacity: 5
            });

            const mediumPromise = limiter.schedule({
                task: mediumPriorityTask,
                priority: 5, // Medium priority
                capacity: 5
            });

            const highPromise = limiter.schedule({
                task: highPriorityTask,
                priority: 1, // High priority
                capacity: 5
            });

            // Free up capacity
            await fillPromise;

            // Advance time to complete the delay
            jest.advanceTimersByTime(100);

            // High priority task should run first
            expect(highPriorityTask).toHaveBeenCalledTimes(1);
            expect(mediumPriorityTask).toHaveBeenCalledTimes(0);
            expect(lowPriorityTask).toHaveBeenCalledTimes(0);

            // Advance time to complete the delay
            jest.advanceTimersByTime(100);

            // Medium priority task should run next
            expect(mediumPriorityTask).toHaveBeenCalledTimes(1);
            expect(lowPriorityTask).toHaveBeenCalledTimes(0);

            await Promise.resolve(); // Allow event loop to process

            // Advance time again
            jest.advanceTimersByTime(100);

            // Low priority task should run last
            expect(lowPriorityTask).toHaveBeenCalledTimes(1);

            // Wait for all promises to resolve
            await Promise.all([highPromise, mediumPromise, lowPromise]);

            // Tasks should execute in priority order with delays
            expect(executionOrder).toEqual(['high', 'medium', 'low']);
        });

        it('should still enforce waiting limits despite delays', async () => {
            limiter = createDefaultLimiter({
                minDelayBetweenTasks: 100
            });

            const executionOrder: string[] = [];

            // Fill capacity
            await limiter.setUsedCapacity(10);

            // Queue a high priority task
            const highPriorityTask = jest.fn().mockImplementation(() => {
                executionOrder.push('high');
                return Promise.resolve('high result');
            });

            // Queue a low priority task with waiting limit
            const limitedTask = jest.fn().mockImplementation(() => {
                executionOrder.push('limited');
                return Promise.resolve('limited result');
            });

            const highPromise = limiter.schedule({
                task: highPriorityTask,
                priority: 1, // High priority
                capacity: 5
            });

            const limitedPromise = limiter.schedule({
                task: limitedTask,
                priority: 9, // Low priority
                capacity: 5,
                queueWaitingLimit: 50 // Short waiting limit
            });

            // No tasks should run yet (capacity is full)
            expect(highPriorityTask).toHaveBeenCalledTimes(0);
            expect(limitedTask).toHaveBeenCalledTimes(0);

            // Advance time to exceed the waiting limit
            jest.advanceTimersByTime(60);

            // Free up capacity
            await limiter.setUsedCapacity(0);

            // Limited task should run first despite lower priority
            // because it exceeded its queue waiting limit
            expect(limitedTask).toHaveBeenCalledTimes(1);
            expect(highPriorityTask).toHaveBeenCalledTimes(0);

            // Advance time to complete the delay
            jest.advanceTimersByTime(100);

            // High priority task should run next
            expect(highPriorityTask).toHaveBeenCalledTimes(1);

            // Wait for all promises to resolve
            await Promise.all([highPromise, limitedPromise]);

            // Limited task should execute first, then high priority
            expect(executionOrder).toEqual(['limited', 'high']);
        });
    });

    describe('timer behavior', () => {
        it('should put timer to sleep and restart when a new task was added', async () => {
            limiter = createDefaultLimiter({
                minDelayBetweenTasks: 100
            });

            const task1 = jest.fn().mockImplementation(() => Promise.resolve('result'));

            jest.setSystemTime(0);

            // Schedule a task
            await limiter.schedule(task1);

            // The queue should be empty, so the timer should be put to sleep

            // Advance time a bit
            jest.advanceTimersByTime(50);

            const task2 = jest.fn().mockImplementation(() => Promise.resolve('result'));

            // Schedule another task, which should wake up the timer
            const task2Promise = limiter.schedule(task2);

            // The second task should not have been called yet
            expect(task2).toHaveBeenCalledTimes(0);

            // Advance time a bit
            jest.advanceTimersByTime(40);

            // The second task should still not have been called
            expect(task2).toHaveBeenCalledTimes(0);

            // Advance time to reach the minDelayBetweenTasks
            jest.advanceTimersByTime(10);

            // The second task should now be called
            expect(task2).toHaveBeenCalledTimes(1);

            await task2Promise;
        });
    });
});
