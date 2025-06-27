// Logic of this calculation is based on: https://github.com/tim-kos/node-retry/blob/master/lib/retry.js

export interface RetryOptions {
    /** The maximum amount of times to retry the operation. Default is 10. Setting this to 1 means "do it once, then retry it once". */
    retries?: number;
    /** The number of milliseconds before starting the first retry. Default is 1000. */
    minTimeout?: number;
    /** The maximum number of milliseconds between two retries. Default is Infinity. */
    maxTimeout?: number;
    /** Randomizes the timeouts by multiplying with a factor between 1 and 2. Default is false. */
    randomize?: boolean;
    /** The factor by which to multiply the timeout. Default is 2. */
    factor?: number;
}

/**
 * Calculates the timeout for the next retry.
 */
export function calculateRetryTimeout(
    attempt: number,
    {factor = 2, minTimeout = 1000, maxTimeout = Infinity, randomize = false}: RetryOptions
) {
    const random = randomize ? Math.random() + 1 : 1;

    let timeout = Math.round(random * Math.max(minTimeout, 1) * Math.pow(factor, attempt - 1));
    timeout = Math.min(timeout, maxTimeout);

    return timeout;
}
