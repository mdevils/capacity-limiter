import {CapacityLimiter} from '../../src/index.js';
import {setupFakeTimers, teardownFakeTimers} from '../common/test-utils.js';

describe('CapacityLimiter: Release Rules', () => {
    beforeEach(() => {
        setupFakeTimers();
    });

    afterEach(() => {
        teardownFakeTimers();
    });

    it('should reset used capacity based on reset release rule', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            capacityStrategy: 'claim',
            releaseRules: [
                {
                    type: 'reset',
                    interval: 100 // Reset capacity every 100ms
                }
            ]
        });

        // Schedule a task that claims 7 capacity
        await limiter.schedule(7, () => Promise.resolve('done'));

        // Second task that needs 5 capacity should be queued
        const secondTask = jest.fn().mockResolvedValue('second result');
        const secondPromise = limiter.schedule(5, secondTask);

        // Task should be queued due to claimed capacity
        expect(secondTask).toHaveBeenCalledTimes(0);

        // Advance time beyond the reset interval
        jest.advanceTimersByTime(110);

        // After reset interval, second task should now execute
        expect(secondTask).toHaveBeenCalledTimes(1);

        const result = await secondPromise;
        expect(result).toBe('second result');
    });

    it('should respect reset value when provided', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            capacityStrategy: 'claim',
            releaseRules: [
                {
                    type: 'reset',
                    value: 4, // Reset to 4 capacity
                    interval: 100
                }
            ]
        });

        // Schedule a task that claims 7 capacity
        await limiter.schedule(7, () => Promise.resolve('done'));

        // A task requiring 4 units should work after reset (10-5=5 available)
        const task1 = jest.fn().mockResolvedValue('task1');
        const promise1 = limiter.schedule(4, task1);

        // A task requiring 6 units should not work after reset (only 5 available)
        const task2 = jest.fn().mockResolvedValue('task2');
        const promise2 = limiter.schedule(6, task2);

        // Both should be queued initially
        expect(task1).toHaveBeenCalledTimes(0);
        expect(task2).toHaveBeenCalledTimes(0);

        // Advance time beyond reset interval
        jest.advanceTimersByTime(110);

        // After reset, task1 should execute (requires 4 units, 6 available)
        expect(task1).toHaveBeenCalledTimes(1);
        expect(task2).toHaveBeenCalledTimes(0); // Still queued

        await promise1;

        // Advance time for another reset
        jest.advanceTimersByTime(110);

        // After second reset, task2 should execute (requires 6 units, 10-4=6 available)
        expect(task2).toHaveBeenCalledTimes(1);

        await promise2;
    });

    it('should reduce used capacity based on reduce release rule', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 8,
            capacityStrategy: 'claim',
            releaseRules: [
                {
                    type: 'reduce',
                    value: 3,
                    interval: 100 // Reduce capacity by 2 every 100ms
                }
            ]
        });

        // Schedule a task that claims 7 capacity
        await limiter.schedule(7, () => Promise.resolve('done'));

        // Second task that needs 2 capacity should be queued initially
        const smallTask = jest.fn().mockResolvedValue('small result');
        const smallPromise = limiter.schedule(2, smallTask);

        // Task shouldn't run yet
        expect(smallTask).toHaveBeenCalledTimes(0);

        // Advance time beyond one reduce interval (reduce by 2)
        jest.advanceTimersByTime(110);

        // Small task requiring 2 capacity should now run
        expect(smallTask).toHaveBeenCalledTimes(1);
        await smallPromise;

        // A medium task requiring 4 capacity should still be queued
        const mediumTask = jest.fn().mockResolvedValue('medium result');
        const mediumPromise = limiter.schedule(4, mediumTask);

        expect(mediumTask).toHaveBeenCalledTimes(0);

        // Advance time beyond one more reduce interval (reduce by 2 more)
        jest.advanceTimersByTime(110);

        // Medium task should now run after second reduction
        expect(mediumTask).toHaveBeenCalledTimes(1);
        await mediumPromise;
    });

    it('should support multiple release rules', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            capacityStrategy: 'claim',
            releaseRules: [
                {
                    type: 'reset',
                    value: 5, // Reset to 5 units
                    interval: 500 // Every 500ms
                },
                {
                    type: 'reduce',
                    value: 1,
                    interval: 100 // Reduce by 1 every 100ms
                }
            ]
        });

        // Schedule a task that claims all capacity
        await limiter.schedule(10, () => Promise.resolve('done'));

        // Advance time to trigger 3 reduce intervals (reduce by 3)
        jest.advanceTimersByTime(310);

        // After 3 reduce intervals, capacity should be 7,
        // so a task requiring 3 units should run
        const task1 = jest.fn().mockResolvedValue('result1');
        expect(await limiter.getUsedCapacity()).toBe(7);
        const promise1 = limiter.schedule(3, task1);

        expect(task1).toHaveBeenCalledTimes(1);
        await promise1;

        // Advance time to trigger reset (reset to 5)
        jest.advanceTimersByTime(200); // Total 510ms

        // Should have 5 capacity left, so a task requiring 5 should run
        const task2 = jest.fn().mockResolvedValue('result2');
        expect(await limiter.getUsedCapacity()).toBe(5);
        const promise2 = limiter.schedule(5, task2);

        expect(task2).toHaveBeenCalledTimes(1);
        await promise2;

        // A task requiring 1 should be queued
        const task3 = jest.fn().mockResolvedValue('result3');
        const promise3 = limiter.schedule(1, task3);

        expect(task3).toHaveBeenCalledTimes(0);

        expect(await limiter.getUsedCapacity()).toBe(10);

        // But after 1 more reduce interval, it should run
        jest.advanceTimersByTime(100); // Total 610ms

        expect(task3).toHaveBeenCalledTimes(1);
        await promise3;
    });

    it('should apply release rules in the correct order', async () => {
        // Test that reset rules take precedence over reduce rules
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            capacityStrategy: 'claim',
            releaseRules: [
                {
                    type: 'reset',
                    interval: 400 // Every 400ms
                },
                {
                    type: 'reduce',
                    value: 2,
                    interval: 100 // Reduce by 2 every 100ms
                }
            ]
        });

        // Schedule a task that claims all capacity
        await limiter.schedule(10, () => Promise.resolve('done'));

        // A task requiring 9 units (should not work after reduced to 6)
        const largeTask = jest.fn().mockResolvedValue('large');
        const largePromise = limiter.schedule(9, largeTask);

        // A task requiring 2 units (should work after educed to 6)
        const smallTask = jest.fn().mockResolvedValue('small');
        const smallPromise = limiter.schedule(2, smallTask);

        expect(largeTask).toHaveBeenCalledTimes(0);
        expect(smallTask).toHaveBeenCalledTimes(0);

        // Advance to trigger reduce
        jest.advanceTimersByTime(310);

        // First should the reducing rule apply (3 times reduce by 2)
        expect(largeTask).toHaveBeenCalledTimes(0); // Still queued, needs 9 units
        expect(smallTask).toHaveBeenCalledTimes(1); // Should run, needs 2 units

        // Advance time to trigger reset
        jest.advanceTimersByTime(100);

        // After reset, the large task should now run (reset to 0)
        expect(largeTask).toHaveBeenCalledTimes(1);

        await smallPromise;

        // Cleanup to avoid hanging test
        largePromise.catch(() => {});
    });

    it('should apply reset rules based on the latest reset time', async () => {
        const limiter = new CapacityLimiter({
            maxCapacity: 10,
            capacityStrategy: 'claim',
            releaseRules: [
                {
                    type: 'reset',
                    value: 8, // Reset to 8 units
                    interval: 300 // Every 300ms
                },
                {
                    type: 'reset',
                    value: 5, // Reset to 5 units
                    interval: 200 // Every 200ms
                }
            ]
        });

        // Schedule a task that claims all capacity
        await limiter.schedule(10, () => Promise.resolve('done'));

        // Advance time to trigger the 200ms reset rule
        jest.advanceTimersByTime(210);

        // A task requiring 4 units should work after reset to 5
        const task1 = jest.fn().mockResolvedValue('task1');
        const task1Promise = limiter.schedule(4, task1);

        expect(task1).toHaveBeenCalledTimes(1);
        await task1Promise;

        // Advance time to trigger the 300ms reset rule
        jest.advanceTimersByTime(100); // Total 310ms

        // Now a task requiring 3 units should not work (reset to 8)
        // But a task requiring 2 units should work
        const task2 = jest.fn().mockResolvedValue('task2');
        const task2Promise = limiter.schedule(3, task2);

        const task3 = jest.fn().mockResolvedValue('task3');
        const task3Promise = limiter.schedule(2, task3);

        expect(task2).toHaveBeenCalledTimes(0);
        expect(task3).toHaveBeenCalledTimes(1);

        await task3Promise;

        // Cleanup
        task2Promise.catch(() => {});
    });
});
