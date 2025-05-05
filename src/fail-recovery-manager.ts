import {calculateRetryTimeout, RetryOptions} from './calculate-retry-timeout.js';
import {CapacityLimiterError} from './capacity-limiter-error.js';

export interface OnFailureParams {
    /** The error that caused the failure. */
    error: unknown;
    /** Attempt number. */
    retryAttempt: number;
}

export type OnFailureResult =
    | {
          type: 'retry';
          timeout: number;
      }
    | {
          type: 'throw-error';
          error: unknown;
      };

export type RetryFailRecoveryStrategy = {
    type: 'retry';
} & RetryOptions;

export interface CustomFailRecoveryStrategy {
    type: 'custom';
    onFailure: (params: OnFailureParams) => Promise<OnFailureResult>;
}

interface RetryTimerInfo<TTask> {
    task: TTask;
    timer: ReturnType<typeof setTimeout>;
    onRetry: () => void;
    onReject: (error: unknown) => void;
}

export class FailRecoveryManager<TTask> {
    protected retryTimers: Set<RetryTimerInfo<TTask>> = new Set();
    protected defaultRetriesLimit: number;

    constructor({defaultRetriesLimit}: {defaultRetriesLimit: number}) {
        this.defaultRetriesLimit = defaultRetriesLimit;
    }

    protected setRetryTimer({
        task,
        timeout,
        onRetry,
        onReject,
        onScheduledRetry
    }: {
        task: TTask;
        timeout: number;
        onRetry: () => void;
        onReject: (error: unknown) => void;
        onScheduledRetry: (timeout: number) => void;
    }) {
        onScheduledRetry(timeout);
        const retryTimerInfo: RetryTimerInfo<TTask> = {
            task,
            timer: setTimeout(() => {
                this.retryTimers.delete(retryTimerInfo);
                onRetry();
            }, timeout),
            onRetry,
            onReject
        };
        this.retryTimers.add(retryTimerInfo);
    }

    public useStrategy({
        task,
        strategy,
        params,
        onReject,
        onScheduledRetry,
        onRetry
    }: {
        task: TTask;
        strategy: RetryFailRecoveryStrategy | CustomFailRecoveryStrategy;
        params: OnFailureParams;
        onReject: (error: unknown) => void;
        onScheduledRetry: (timeout: number) => void;
        onRetry: () => void;
    }) {
        if (strategy.type === 'retry') {
            if (params.retryAttempt > (strategy.retries ?? this.defaultRetriesLimit)) {
                onReject(params.error);
            } else {
                this.setRetryTimer({
                    task,
                    timeout: calculateRetryTimeout(params.retryAttempt, strategy),
                    onRetry,
                    onReject,
                    onScheduledRetry
                });
            }
        } else {
            Promise.resolve()
                .then(() => strategy.onFailure(params))
                .then(
                    (result) => {
                        if (result.type === 'throw-error') {
                            onReject(result.error);
                        } else if (result.type === 'retry') {
                            this.setRetryTimer({
                                task: task,
                                timeout: result.timeout,
                                onRetry,
                                onReject,
                                onScheduledRetry
                            });
                        }
                    },
                    (onFailureError) => {
                        onReject(
                            new CapacityLimiterError(
                                'on-failure-error',
                                `Error in onFailure callback: ${String(onFailureError)}`,
                                params.error
                            )
                        );
                    }
                );
        }
    }

    public rejectAll(error: unknown) {
        for (const retryTimerInfo of Array.from(this.retryTimers)) {
            clearTimeout(retryTimerInfo.timer);
            retryTimerInfo.onReject(error);
        }
        this.retryTimers.clear();
    }

    public getAwaitingTasks(): TTask[] {
        return Array.from(this.retryTimers).map((retryTimerInfo) => retryTimerInfo.task);
    }
}
