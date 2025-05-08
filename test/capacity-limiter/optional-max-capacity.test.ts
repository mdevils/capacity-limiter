import {CapacityLimiter, CapacityLimiterError} from '../../src/index.js';

describe('CapacityLimiter with optional maxCapacity', () => {
    it('should initialize without maxCapacity', () => {
        // Should not throw error when maxCapacity is not specified
        const limiter = new CapacityLimiter({});
        expect(limiter.getOptions().maxCapacity).toBeUndefined();
    });

    it('should allow scheduling tasks when maxCapacity is not specified', async () => {
        const limiter = new CapacityLimiter({});

        // Schedule a task
        const result = await limiter.schedule(() => Promise.resolve('test'));
        expect(result).toBe('test');

        // Schedule multiple tasks
        const results = await Promise.all([
            limiter.schedule(() => Promise.resolve(1)),
            limiter.schedule(() => Promise.resolve(2)),
            limiter.schedule(() => Promise.resolve(3))
        ]);
        expect(results).toEqual([1, 2, 3]);

        // Schedule with explicit capacity
        const capacityResult = await limiter.schedule(100, () => Promise.resolve('large capacity'));
        expect(capacityResult).toBe('large capacity');
    });

    it('should throw when trying to set used capacity when maxCapacity is not specified', () => {
        const limiter = new CapacityLimiter({});

        expect(() => limiter.setUsedCapacity(5)).toThrow(
            new CapacityLimiterError('invalid-call', 'Cannot set used capacity when maxCapacity is not specified.')
        );
    });

    it('should throw when trying to modify used capacity when maxCapacity is not specified', () => {
        const limiter = new CapacityLimiter({});

        expect(() => limiter.adjustUsedCapacity(5)).toThrow(
            new CapacityLimiterError('invalid-call', 'Cannot adjust capacity when maxCapacity is not specified.')
        );
    });

    it('should allow adding maxCapacity after initialization via setOptions', () => {
        const limiter = new CapacityLimiter({});
        expect(limiter.getOptions().maxCapacity).toBeUndefined();

        limiter.setOptions({maxCapacity: 10});
        expect(limiter.getOptions().maxCapacity).toBe(10);
    });

    it('should respect maxCapacity after it is added via setOptions', async () => {
        const limiter = new CapacityLimiter({});

        // First, set maxCapacity and ensure taskExceedsMaxCapacityStrategy is 'throw-error'
        limiter.setOptions({
            maxCapacity: 20,
            taskExceedsMaxCapacityStrategy: 'throw-error'
        });

        limiter.setOptions({maxCapacity: 10});

        // Try to schedule a task that exceeds capacity
        try {
            limiter.schedule(11, () => Promise.resolve());
            throw new Error('Expected to throw but did not throw');
        } catch (e) {
            expect(e).toMatchObject(
                new CapacityLimiterError('max-capacity-exceeded', `Task capacity (11) exceeds maxCapacity (10).`)
            );
        }
    });

    it('should throw when releaseRules are specified without maxCapacity', () => {
        expect(() => {
            new CapacityLimiter({
                releaseRules: [
                    {
                        type: 'reset',
                        interval: 60000 // Reset every minute
                    }
                ]
            });
        }).toThrow(
            new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Cannot use releaseRules when maxCapacity is not specified.'
            )
        );
    });

    it('should throw when adding releaseRules without maxCapacity via setOptions', () => {
        const limiter = new CapacityLimiter({});

        expect(() => {
            limiter.setOptions({
                releaseRules: [
                    {
                        type: 'reset',
                        interval: 60000
                    }
                ]
            });
        }).toThrow(
            new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Cannot use releaseRules when maxCapacity is not specified.'
            )
        );
    });

    it('should throw when capacityStrategy is specified without maxCapacity', () => {
        expect(() => {
            new CapacityLimiter({
                capacityStrategy: 'claim'
            });
        }).toThrow(
            new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Cannot use capacityStrategy when maxCapacity is not specified.'
            )
        );
    });

    it('should throw when adding capacityStrategy without maxCapacity via setOptions', () => {
        const limiter = new CapacityLimiter({});

        expect(() => {
            limiter.setOptions({
                capacityStrategy: 'claim'
            });
        }).toThrow(
            new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Cannot use capacityStrategy when maxCapacity is not specified.'
            )
        );
    });
});
