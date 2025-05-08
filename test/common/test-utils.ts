import {CapacityLimiter, CapacityLimiterOptions} from '../../src/index.js';

/**
 * Standard test configuration for CapacityLimiter
 */
export const DEFAULT_TEST_OPTIONS: CapacityLimiterOptions = {
    maxCapacity: 10
};

/**
 * Creates a controlled promise that can be resolved or rejected externally.
 * Useful for testing asynchronous behavior in a controlled manner.
 *
 * @template T - The type of value that will resolve the promise
 * @returns Object containing the promise and functions to resolve or reject it
 */
export function createControlledPromise<T = unknown>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: any) => void;
} {
    let resolve: (value: T) => void;
    let reject: (error: any) => void;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return {promise, resolve: resolve!, reject: reject!};
}

/**
 * Creates a Jest mock function that allows waiting for it to be called.
 *
 * @template T - The type of arguments the function will receive
 * @param impl - Optional implementation function
 * @returns Object containing the mock function and a method to wait for it to be called
 */
export function createWaitableFn<T extends unknown[]>(impl?: (...args: T) => Promise<unknown>) {
    const waitPromiseResolves: (() => void)[] = [];
    function callWaitPromiseResolves() {
        waitPromiseResolves.forEach((resolve) => resolve());
        waitPromiseResolves.length = 0;
    }
    return {
        fn: jest.fn().mockImplementation((...args: T) => {
            try {
                if (impl) {
                    const result = impl(...args);
                    result.finally(() => Promise.resolve().then(callWaitPromiseResolves));
                    return result;
                }
            } catch (err) {
                callWaitPromiseResolves();
                throw err;
            }
        }),
        waitForCall() {
            return new Promise<void>((resolve) => {
                waitPromiseResolves.push(resolve);
            });
        }
    };
}

/**
 * Setup function for tests that need fake timers.
 * Call this in beforeEach to ensure consistent test setup.
 *
 * @param systemTime - Optional time to set as the system time
 */
export function setupFakeTimers(systemTime?: number) {
    if (systemTime) {
        jest.useFakeTimers().setSystemTime(systemTime);
    } else {
        jest.useFakeTimers();
    }
}

/**
 * Teardown function for tests that use fake timers.
 * Call this in afterEach to ensure consistent test cleanup.
 */
export function teardownFakeTimers() {
    jest.useRealTimers();
    jest.restoreAllMocks();
}

/**
 * Default limiter factory with standard test configuration.
 *
 * @param overrideOptions - Optional options to override the defaults
 * @returns A new CapacityLimiter instance
 */
export function createDefaultLimiter(overrideOptions: Partial<CapacityLimiterOptions> = {}): CapacityLimiter {
    return new CapacityLimiter({...DEFAULT_TEST_OPTIONS, ...overrideOptions});
}

/**
 * Creates a task that counts its invocations and can track execution order.
 *
 * @param result - The value to resolve the task promise with
 * @param executionOrder - Array to track the order of execution
 * @param id - Identifier for this task in the execution order
 * @returns A Jest mock function that resolves with the given result
 */
export function createCountedTask(
    result: any = 'result',
    executionOrder: Array<number | string> = [],
    id: number | string = 'default'
) {
    return jest.fn().mockImplementation(() => {
        executionOrder.push(id);
        return Promise.resolve(result);
    });
}

/**
 * Creates a controlled task that resolves with the given result when its resolve function is called.
 *
 * @param executionOrder - Array to track the order of execution
 * @param id - Identifier for this task in the execution order
 * @returns Object containing the task function and methods to resolve or reject it
 */
export function createControlledTask(executionOrder: Array<number | string> = [], id: number | string = 'default') {
    const {promise, resolve, reject} = createControlledPromise();

    const task = jest.fn().mockImplementation(() => {
        executionOrder.push(id);
        return promise;
    });

    return {task, resolve, reject};
}

/**
 * Creates a task that fails with the given error.
 *
 * @param error - The error to reject the task promise with
 * @param executionOrder - Array to track the order of execution
 * @param id - Identifier for this task in the execution order
 * @returns A Jest mock function that rejects with the given error
 */
export function createFailingTask(
    error: any = new Error('Task failed'),
    executionOrder: Array<number | string> = [],
    id: number | string = 'default'
) {
    return jest.fn().mockImplementation(() => {
        executionOrder.push(id);
        return Promise.reject(error);
    });
}

/**
 * Fill a limiter to capacity with a controlled task.
 *
 * @param limiter - The CapacityLimiter instance to fill
 * @param capacity - The capacity to use (defaults to the limiter's max capacity)
 * @returns Object containing the fill task and methods to resolve or reject it
 */
export function fillLimiterToCapacity(limiter: CapacityLimiter, capacity?: number) {
    const fillTaskMock = createControlledTask();
    const maxCapacity = limiter.getOptions().maxCapacity;

    if (maxCapacity === undefined && capacity === undefined) {
        throw new Error('Cannot fill limiter to capacity when maxCapacity is not specified');
    }

    const fillPromise = limiter.schedule(capacity ?? maxCapacity!, fillTaskMock.task);

    return {
        task: fillTaskMock.task,
        resolve: fillTaskMock.resolve,
        reject: fillTaskMock.reject,
        promise: fillPromise
    };
}
