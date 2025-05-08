import {CapacityLimiterError} from './capacity-limiter-error.js';
import {DoubleLinkedList} from './double-linked-list.js';
import {CustomFailRecoveryStrategy, FailRecoveryManager, RetryFailRecoveryStrategy} from './fail-recovery-manager.js';
import {ReleaseRule, ReleaseRuleManager} from './release-rule-manager.js';

/**
 * Capacity Limiter Fail Recovery Strategy.
 */
export type FailRecoveryStrategy = 'none' | 'retry' | RetryFailRecoveryStrategy | CustomFailRecoveryStrategy;

/**
 * Capacity Limiter Options.
 */
export interface CapacityLimiterOptions {
    /**
     * The maximum capacity for the limiter.
     * This can be memory, CPU, or any other resource that you want to limit.
     * Should be a non-negative number (greater than or equal to 0).
     * If not specified, capacity will not be limited.
     */
    maxCapacity?: number;
    /**
     * The current capacity of the limiter.
     * This can be used to specify capacity that is already in use.
     * Should be a non-negative number (greater than or equal to 0).
     * Default is 0.
     */
    initiallyUsedCapacity?: number;
    /**
     * Specifies how capacity is managed when a task is executed.
     * Default is 'borrow'.
     *
     *  * `claim`, capacity used by the task is claimed.
     *    Use this when tasks represent one-time or lasting usage of resources
     *    (e.g. memory allocation, API rate limits, etc.).
     *  * `reserve`, capacity is temporarily reserved during task execution and returned automatically
     *    after the task finishes.
     *    Use this when tasks only need the resource for the duration of their execution
     *    (e.g. concurrent execution slots, temporary CPU usage, memory usage, etc.).
     */
    capacityStrategy?: 'reserve' | 'claim';
    /**
     * Rules to release used capacity. Can be used to reset the used capacity regularly.
     * Useful when `useCapacityStrategy` is set to `claim`.
     */
    releaseRules?: ReleaseRule[];
    /**
     * Strategy to use when the task exceeds the maximum capacity. Default is 'throw-error'.
     *
     *  * `throw-error`, the task will throw an error when scheduled with a capacity greater than the maximum.
     *  * `wait-for-full-capacity`, the task will wait until the current capacity is zero before executing.
     */
    taskExceedsMaxCapacityStrategy?: 'throw-error' | 'wait-for-full-capacity';
    /**
     * The maximum number of concurrent tasks that can be executed.
     * No limit if not set.
     */
    maxConcurrent?: number;
    /**
     * The maximum size of the task queue.
     * No limit if not set.
     */
    maxQueueSize?: number;
    /**
     * Strategy to use when the queue size exceeds the maximum.
     * Default is 'throw-error'.
     *
     *  * `throw-error`, the task will throw an error when scheduled with a queue size greater than the maximum.
     *  * `replace`, older tasks will be removed from the queue and rejected to make space for the new task.
     *  * `replace-by-priority`, less priority tasks will be removed from the queue to make space for the new task.
     */
    queueSizeExceededStrategy?: 'throw-error' | 'replace' | 'replace-by-priority';
    /**
     * Limit the time a task can wait in the queue.
     * Once the limit is reached, the task will be executed with the highest priority.
     * In case of tasks with high capacity, scheduler will wait until the capacity is available.
     * Time in milliseconds.
     */
    queueWaitingLimit?: number;
    /**
     * The time to wait before removing a task from the queue.
     * This will fail tasks that are waiting for too long.
     * Time in milliseconds.
     */
    queueWaitingTimeout?: number;
    /**
     * Fails tasks that are not executed within the specified time.
     * This means that the Promise of the task will be rejected and the capacity will be released.
     * Time in milliseconds.
     *
     * Keep in mind that this will not stop the execution of the task, but it will reject the promise.
     */
    executionTimeout?: number;
    /**
     * Fail recovery strategy. Can be used to retry tasks that fail.
     */
    failRecoveryStrategy?: FailRecoveryStrategy;
}

/**
 * Common params for a task in the Capacity Limiter.
 */
export interface TaskParams<TResult = unknown> {
    /**
     * The task to be scheduled.
     */
    task(): Promise<TResult>;
    /**
     * How much capacity this task will consume.
     * This is used to determine if the task can be executed immediately or if it needs to wait in the queue.
     * Should be a positive number (greater than 0).
     */
    capacity?: number;
    /**
     * The priority of the task. 0 is the highest priority and 9 is the lowest.
     * Accepts values from 0 to 9.
     */
    priority?: number;
    /**
     * Limit the time a task can wait in the queue.
     * Once the limit is reached, the task will be executed with the highest priority.
     * In case of tasks with high capacity, scheduler will wait until the capacity is available.
     * Time in milliseconds.
     */
    queueWaitingLimit?: number;
    /**
     * The time to wait before removing a task from the queue.
     * This will fail tasks that are waiting for too long.
     * Time in milliseconds.
     */
    queueWaitingTimeout?: number;
    /**
     * Fails this task if it is not executed within the specified time.
     * This means that the Promise of the task will be rejected and the capacity will be released.
     * Time in milliseconds.
     *
     * Keep in mind that this will not stop the execution of the task, but it will reject the promise.
     */
    executionTimeout?: number;
    /**
     * Fail recovery strategy for a task. Can be used to retry tasks that fail.
     */
    failRecoveryStrategy?: FailRecoveryStrategy;
}

/**
 * Params for the `stop()` method.
 */
export interface StopParams {
    /**
     * If set to true, all queued tasks will be removed and their promises rejected.
     * Also rejects the promises of the tasks that are currently executing.
     * Default is false.
     *
     * Keep in mind that this will not stop the execution of the task, but it will reject the promise.
     */
    stopAll?: boolean;
    /**
     * If set to true, the tasks that are waiting in the queue will be removed and their promises rejected.
     * Default is false.
     */
    stopWaitingTasks?: boolean;
    /**
     * If set to true, the tasks that are currently executing will be rejected.
     * Default is false.
     *
     * Keep in mind that this will not stop the execution of the task, but it will reject the promise.
     */
    rejectExecutingTasks?: boolean;
    /**
     * If set to true, the tasks that are currently awaiting a retry will be stopped and their promises rejected.
     * Default is false.
     */
    stopTaskRetries?: boolean;
}

/**
 * Default priority for tasks.
 * Used when no priority is specified.
 */
const defaultPriority = 5;

/**
 * Default capacity for tasks.
 * Used when no capacity is specified.
 */
const defaultCapacity = 1;

/**
 * Default retries limit for tasks.
 */
const defaultRetriesLimit = 10;

/**
 * Maximum priority for tasks.
 * Used to determine the highest priority task in the queue.
 */
const maxPriority = 9;

/**
 * Default retry options for tasks.
 */
const defaultRetryOptions: RetryFailRecoveryStrategy = {type: 'retry'};

/**
 * Internal Task interface for the Capacity Limiter.
 */
interface Task {
    /**
     * The priority of the task. 0 is the highest priority and 9 is the lowest.
     */
    priority: number;
    /**
     * The capacity of the task. This is used to determine if the task can be executed immediately or if it needs to wait in the queue.
     */
    capacity: number;
    /**
     * Actual capacity taken by the task right now.
     */
    reservedCapacity?: number;
    /**
     * Actual number of concurrent tasks taken by the task right now.
     */
    reservedConcurrent?: number;
    /**
     * The time the task was added to the queue.
     */
    timeAdded: number;
    /**
     * The time before task should be executed.
     */
    timeLimit?: number;
    /**
     * The timer for the task execution timeout.
     */
    executionTimerId?: ReturnType<typeof setTimeout>;
    /**
     * The timer for the task queue waiting timeout.
     */
    queueWaitingTimerId?: ReturnType<typeof setTimeout>;
    /**
     * Current retry attempt.
     */
    retryAttempt?: number;
    /**
     * The callback to be executed when the task is picked from the queue.
     */
    callback(...args: unknown[]): Promise<unknown>;
    /**
     * Task params.
     */
    params: Omit<TaskParams, 'task'>;
    /**
     * Task execution resolution.
     */
    resolve: (result: unknown) => void;
    /**
     * Task execution rejection.
     */
    reject: (error: unknown) => void;
    /**
     * Promise of the task execution.
     */
    promise: Promise<unknown>;
}

const defaultOptions = {
    capacityStrategy: 'reserve',
    taskExceedsMaxCapacityStrategy: 'throw-error',
    queueSizeExceededStrategy: 'throw-error'
} satisfies CapacityLimiterOptions;

/**
 * Capacity Limiter is a task scheduler that limits the number of concurrent tasks based on a specified capacity.
 */
export class CapacityLimiter {
    /** Currently used capacity. */
    protected usedCapacity = 0;
    /** Number of currently used concurrent tasks. */
    protected usedConcurrent = 0;
    /** Queue of tasks to be executed. */
    protected queue: DoubleLinkedList<Task> = new DoubleLinkedList();
    /** Tasks ordered by time added. */
    protected tasksByTimeAdded: DoubleLinkedList<Task> = new DoubleLinkedList();
    /** Tasks that are waiting for their time limit to expire. */
    protected tasksByTimeLimit: DoubleLinkedList<Task> = new DoubleLinkedList();
    /** Actual options used by the Capacity Limiter. */
    protected options: Omit<CapacityLimiterOptions, keyof typeof defaultOptions> &
        Required<Pick<CapacityLimiterOptions, keyof typeof defaultOptions>>;
    /** The original options passed to the constructor or `setOptions()`. */
    protected originalOptions: CapacityLimiterOptions;
    /** Release rule manager reduces used capacity following specified rules. */
    protected releaseRuleManager: ReleaseRuleManager;
    /** The fail recovery manager is used to handle task failures and retries. */
    protected failRecoveryManager: FailRecoveryManager<Task> = new FailRecoveryManager({
        defaultRetriesLimit
    });
    /** Currently running tasks. */
    protected executingTasks: Set<Task> = new Set();
    /** This means that capacity limiter is stopped and no tasks will be executed. */
    protected stopped?: {
        /** The Promise that is returned by the `stop()` method. */
        stoppedPromise?: Promise<void>;
        /** The resolve method of the promise that was returned by the `stop()` method. */
        stoppedResolve?: () => void;
    };

    /**
     * Creates a new Capacity Limiter instance.
     * @param options Options for the Capacity Limiter.
     *
     * @throws {CapacityLimiterError} with types:
     * - `invalid-argument` - Invalid argument when calling the method.
     */
    constructor(options: CapacityLimiterOptions) {
        this.releaseRuleManager = new ReleaseRuleManager({
            applyRule: (rule, times) => {
                if (rule.type === 'reset') {
                    this.usedCapacity = rule.value ?? 0;
                } else if (rule.type === 'reduce') {
                    this.usedCapacity = Math.max(0, this.usedCapacity - rule.value * times);
                }
            },
            applyCapacity: () => {
                this.startNextTaskIfPossible();
            },
            canReduceCapacity: () => this.usedCapacity > 0
        });
        this.checkMaxCapacity(options.maxCapacity);
        this.checkUsedCapacity(options.initiallyUsedCapacity, options.maxCapacity);
        this.checkCapacityStrategy(options.capacityStrategy, options.maxCapacity);
        this.checkReleaseRules(options.releaseRules, options.maxCapacity);
        this.originalOptions = options;
        this.options = {
            ...defaultOptions,
            ...options
        };
        this.usedCapacity = this.options.initiallyUsedCapacity ?? 0;
        this.releaseRuleManager.setRules(this.options.releaseRules ?? []);
    }

    /**
     * Returns the current options of the Capacity Limiter.
     */
    public getOptions(): CapacityLimiterOptions {
        return this.originalOptions;
    }

    /**
     * Sets the options of the Capacity Limiter.
     *
     * @throws {CapacityLimiterError} with types:
     * - `invalid-argument` - Invalid argument when calling the method.
     */
    public setOptions(options: CapacityLimiterOptions) {
        this.checkMaxCapacity(options.maxCapacity);
        this.checkCapacityStrategy(options.capacityStrategy, options.maxCapacity);
        this.checkReleaseRules(options.releaseRules, options.maxCapacity);
        this.options = {
            ...defaultOptions,
            ...options
        };
        this.originalOptions = options;
        this.releaseRuleManager.setRules(this.options.releaseRules ?? []);
    }

    /**
     * Checks if the max capacity is valid.
     */
    protected checkMaxCapacity(maxCapacity?: number) {
        if (maxCapacity === undefined) {
            return;
        }
        if (maxCapacity < 0) {
            throw new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Expected a non-negative number as the maxCapacity.'
            );
        }
    }

    /**
     * Checks if the used capacity is valid.
     */
    protected checkUsedCapacity(usedCapacity?: number, maxCapacity?: number) {
        if (usedCapacity === undefined) {
            return;
        }
        if (maxCapacity === undefined) {
            throw new CapacityLimiterError(
                'invalid-call',
                'Cannot set used capacity when maxCapacity is not specified.'
            );
        }
        if (usedCapacity < 0) {
            throw new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Expected a non-negative number as the used capacity.'
            );
        }
        if (usedCapacity > maxCapacity) {
            throw new CapacityLimiterError(
                'invalid-argument',
                `Invalid argument. Expected a number less than or equal to ${maxCapacity} as the used capacity.`
            );
        }
    }

    /**
     * Checks if the capacity strategy is valid.
     */
    protected checkCapacityStrategy(
        capacityStrategy: CapacityLimiterOptions['capacityStrategy'],
        maxCapacity?: number
    ) {
        if (capacityStrategy && maxCapacity === undefined) {
            throw new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Cannot use capacityStrategy when maxCapacity is not specified.'
            );
        }
    }

    /**
     * Checks if the release rules are valid.
     */
    protected checkReleaseRules(releaseRules: CapacityLimiterOptions['releaseRules'], maxCapacity?: number) {
        if (releaseRules && releaseRules.length > 0 && maxCapacity === undefined) {
            throw new CapacityLimiterError(
                'invalid-argument',
                'Invalid argument. Cannot use releaseRules when maxCapacity is not specified.'
            );
        }
    }

    /**
     * Returns the current used capacity of the Capacity Limiter.
     */
    public async getUsedCapacity(): Promise<number> {
        if (!this.releaseRuleManager.areTimersEnabled()) {
            this.releaseRuleManager.applyMissedRules(Date.now());
        }
        return this.usedCapacity;
    }

    /**
     * Sets the used capacity of the Capacity Limiter.
     *
     * @throws {CapacityLimiterError} with types:
     * - `invalid-argument` - Invalid argument when calling the method.
     */
    public setUsedCapacity(usedCapacity: number) {
        this.checkUsedCapacity(usedCapacity, this.options.maxCapacity);
        this.usedCapacity = usedCapacity;
        this.startNextTaskIfPossible();
        return Promise.resolve();
    }

    /**
     * Adds a value to the used capacity of the Capacity Limiter.
     * In case of a negative value, it will be subtracted from the used capacity.
     */
    public adjustUsedCapacity(diff: number) {
        if (this.options.maxCapacity === undefined) {
            throw new CapacityLimiterError('invalid-call', 'Cannot adjust capacity when maxCapacity is not specified.');
        }
        this.usedCapacity = Math.min(Math.max(0, this.usedCapacity + diff), this.options.maxCapacity);
        this.startNextTaskIfPossible();
        return Promise.resolve();
    }

    /**
     * Checks if the task can fit in the current capacity.
     */
    protected canFitTask(task: Task): boolean {
        // If maxCapacity is not specified, any task can fit
        if (this.options.maxCapacity === undefined) {
            return true;
        }
        return this.usedCapacity + task.capacity <= this.options.maxCapacity;
    }

    /**
     * Picks the next task from the queue if possible and executes it.
     */
    protected startNextTaskIfPossible() {
        if (this.stopped && this.queue.length === 0) {
            this.stopped.stoppedResolve?.();
            return;
        }

        if (this.options.maxConcurrent && this.usedConcurrent >= this.options.maxConcurrent) {
            return;
        }

        let taskToExecute: Task | undefined;
        // Important task is the task that have a time limit and are waiting for it to expire.
        const importantTask = this.tasksByTimeLimit.peekFirst();
        if (importantTask) {
            if (importantTask.timeLimit! <= Date.now()) {
                if (this.canFitTask(importantTask)) {
                    taskToExecute = importantTask;
                } else {
                    return;
                }
            }
        }

        if (!taskToExecute) {
            // Pick the first task that can fit in the current capacity starting from the highest priority.
            taskToExecute = this.queue.pickFirstMatching((task) => this.canFitTask(task));
        }

        if (!taskToExecute) {
            return;
        }

        // Only reserve capacity if maxCapacity is specified
        if (this.options.maxCapacity !== undefined) {
            if (this.options.capacityStrategy === 'reserve') {
                // Explicitly specify that the task is reserving the capacity.
                taskToExecute.reservedCapacity = taskToExecute.capacity;
            }
            this.usedCapacity += taskToExecute.capacity;
        }

        // If timer had a queue waiting timeout, it will be cleared.
        if (taskToExecute.queueWaitingTimerId) {
            clearTimeout(taskToExecute.queueWaitingTimerId);
            taskToExecute.queueWaitingTimerId = undefined;
        }

        // Explicitly specify that the task is reserving the concurrent tasks.
        taskToExecute.reservedConcurrent = 1;
        this.usedConcurrent += 1;
        this.queue.delete(taskToExecute);
        this.tasksByTimeAdded.delete(taskToExecute);
        if (taskToExecute.timeLimit) {
            this.tasksByTimeLimit.delete(taskToExecute);
        }
        this.executeTask(taskToExecute);

        if (this.queue.length === 0) {
            // If queue is empty, disable timers to save resources.
            // This also avoids keeping node.js running if there are no tasks to execute.
            this.releaseRuleManager.disableTimers();
        } else {
            // If there are tasks in the queue, we need to check if we can execute the next task.
            this.startNextTaskIfPossible();
        }
    }

    /**
     * Executes a scheduled task.
     */
    protected executeTask(task: Task) {
        /** Makes sure task is only resolved / rejected once per execution. */
        let finished = false;
        this.executingTasks.add(task);
        try {
            const executionTimeout = task.params.executionTimeout ?? this.options.executionTimeout;
            if (executionTimeout) {
                // If the task has an execution timeout, set a timer to reject the task if it takes too long.
                task.executionTimerId = setTimeout(() => {
                    if (!finished) {
                        this.executingTasks.delete(task);
                        finished = true;
                        this.tryRejectTask(
                            task,
                            new CapacityLimiterError('execution-timeout', 'Task execution timeout.')
                        );
                    }
                }, executionTimeout);
            }
            task.callback().then(
                (result) => {
                    if (!finished) {
                        this.executingTasks.delete(task);
                        finished = true;
                        this.resolveTask(task, result);
                    }
                },
                (error) => {
                    if (!finished) {
                        this.executingTasks.delete(task);
                        finished = true;
                        this.tryRejectTask(task, error);
                    }
                }
            );
        } catch (error) {
            this.executingTasks.delete(task);
            finished = true;
            // Error was thrown synchronously, it will be handled as a rejection.
            this.tryRejectTask(task, error);
        }
    }

    /**
     * Tries to reject the task and release its resources.
     * If the task has a fail recovery strategy, it will be applied.
     */
    protected tryRejectTask(task: Task, error: unknown) {
        this.releaseTaskResources(task);
        const failRecoveryStrategy = task.params.failRecoveryStrategy ?? this.options.failRecoveryStrategy;
        if (failRecoveryStrategy && failRecoveryStrategy !== 'none') {
            task.retryAttempt = (task.retryAttempt ?? 0) + 1;
            this.failRecoveryManager.useStrategy({
                task,
                strategy: failRecoveryStrategy === 'retry' ? defaultRetryOptions : failRecoveryStrategy,
                params: {
                    error,
                    retryAttempt: task.retryAttempt
                },
                onReject: task.reject,
                onScheduledRetry: (timeout) => {
                    task.timeLimit = Date.now() + timeout;
                },
                onRetry: () => this.scheduleTask(task)
            });
        } else {
            task.reject(error);
        }
        this.startNextTaskIfPossible();
    }

    /**
     * Removes the task from the queues.
     */
    protected removeTaskFromQueues(task: Task) {
        this.queue.delete(task);
        this.tasksByTimeAdded.delete(task);
        this.tasksByTimeLimit.delete(task);
    }

    /**
     * Resolves the task and releases its resources.
     */
    protected resolveTask(task: Task, result: unknown) {
        this.releaseTaskResources(task);
        task.resolve(result);
        this.startNextTaskIfPossible();
    }

    /**
     * Releases the resources used by the task: capacity, concurrent tasks, and execution timer.
     */
    protected releaseTaskResources(task: Task) {
        task.timeLimit = undefined;
        if (task.reservedConcurrent) {
            this.usedConcurrent = Math.max(0, this.usedConcurrent - task.reservedConcurrent);
            task.reservedConcurrent = 0;
        }
        if (task.reservedCapacity && this.options.maxCapacity !== undefined) {
            this.usedCapacity = Math.max(0, this.usedCapacity - task.reservedCapacity);
            task.reservedCapacity = 0;
        }
        if (task.executionTimerId) {
            clearTimeout(task.executionTimerId);
            task.executionTimerId = undefined;
        }
    }

    /**
     * Schedules a task to be executed.
     * The task will be executed when the current capacity allows it.
     */
    protected scheduleTask(task: Task) {
        if (this.stopped) {
            task.reject(new CapacityLimiterError('stopped', 'Capacity limiter was stopped. Task was rejected.'));
            return;
        }

        if (this.options.maxCapacity !== undefined && task.capacity > this.options.maxCapacity) {
            if (this.options.taskExceedsMaxCapacityStrategy === 'throw-error') {
                throw new CapacityLimiterError(
                    'max-capacity-exceeded',
                    `Task capacity (${task.capacity}) exceeds maxCapacity (${this.options.maxCapacity}).`
                );
            } else {
                task.capacity = this.options.maxCapacity;
            }
        }
        if (task.capacity < 0) {
            throw new CapacityLimiterError(
                'invalid-argument',
                `Invalid argument. Expected a non-negative number as the task capacity.`
            );
        }
        if (task.priority < 0 || task.priority > maxPriority) {
            throw new CapacityLimiterError(
                'invalid-argument',
                `Invalid argument. Expected a number from 0 to ${maxPriority} as the task priority.`
            );
        }
        if (this.options.maxQueueSize && this.queue.length >= this.options.maxQueueSize) {
            if (this.options.queueSizeExceededStrategy === 'throw-error') {
                task.reject(
                    new CapacityLimiterError(
                        'queue-size-exceeded',
                        'Task queue size exceeded. Max queue size: ' + this.options.maxQueueSize + '.'
                    )
                );
                return;
            } else if (this.options.queueSizeExceededStrategy === 'replace-by-priority') {
                const leastPriorityTask = this.queue.peekLast();
                if (leastPriorityTask && leastPriorityTask.priority > task.priority) {
                    this.removeTaskFromQueues(leastPriorityTask);
                    leastPriorityTask.reject(
                        new CapacityLimiterError(
                            'queue-size-exceeded',
                            'Task queue size exceeded, rejecting the lowest priority task. Max queue size: ' +
                                this.options.maxQueueSize +
                                '.'
                        )
                    );
                } else {
                    task.reject(
                        new CapacityLimiterError(
                            'queue-size-exceeded',
                            'Task queue size exceeded, rejecting the new low priority task. Max queue size: ' +
                                this.options.maxQueueSize +
                                '.'
                        )
                    );
                    return;
                }
            } else if (this.options.queueSizeExceededStrategy === 'replace') {
                const oldestTask = this.tasksByTimeAdded.shift();
                if (oldestTask) {
                    this.removeTaskFromQueues(oldestTask);
                    oldestTask.reject(
                        new CapacityLimiterError(
                            'queue-size-exceeded',
                            'Task queue size exceeded, rejecting the oldest task. Max queue size: ' +
                                this.options.maxQueueSize +
                                '.'
                        )
                    );
                }
            }
        }
        if (task.capacity < 0) {
            task.reject(
                new CapacityLimiterError(
                    'invalid-argument',
                    `Invalid argument. Expected a non-negative number as the task capacity.`
                )
            );
            return;
        }
        this.queue.putAfter(task, ({priority}) => priority <= task.priority);
        this.tasksByTimeAdded.push(task);
        const queueWaitingLimit = task.params.queueWaitingLimit ?? this.options.queueWaitingLimit;
        if (queueWaitingLimit && !task.timeLimit) {
            task.timeLimit = task.timeAdded + queueWaitingLimit;
        }
        if (task.timeLimit) {
            this.tasksByTimeLimit.putBefore(task, ({timeLimit}) => task.timeLimit! < timeLimit!);
        }
        const queueWaitingTimeout = task.params.queueWaitingTimeout ?? this.options.queueWaitingTimeout;
        if (queueWaitingTimeout && !task.retryAttempt) {
            task.queueWaitingTimerId = setTimeout(() => {
                this.removeTaskFromQueues(task);
                task.reject(
                    new CapacityLimiterError(
                        'queue-timeout',
                        `Task queue waiting timeout. Task was in the queue for ${queueWaitingTimeout}ms.`
                    )
                );
            }, queueWaitingTimeout);
        }
        this.releaseRuleManager.enableTimers();
        this.startNextTaskIfPossible();
    }

    /**
     * Schedules a task to be executed.
     * The task will be executed when the current capacity allows it.
     *
     * Edge cases:
     *
     * - In case if task capacity exceeds the maximum capacity and `taskExceedsMaxCapacityStrategy` is set to
     *   `throw-error`, this method returns a rejected promise with an error: `CapacityLimiterError` with type
     *   'max-capacity-exceeded'.
     *
     * - In case if `maxQueueSize` is set and:
     *
     *    - `queueSizeExceededStrategy` is set to `throw-error`, this method returns a rejected promise with an error:
     *      `CapacityLimiterError` with type 'queue-size-exceeded'.
     *    - `queueSizeExceededStrategy` is set to `replace-by-priority`, this method rejects the task with the lowest
     *      priority task. If the new task has lower priority than the task with the lowest priority in the queue,
     *      it will be rejected, otherwise the task with the lowest priority will be removed from the queue and the
     *      task will be scheduled.
     *    - `queueSizeExceededStrategy` is set to `replace`, this method rejects the task with the oldest time added
     *      task and the new task will be added to the queue.
     *    - Tasks rejected due to `maxQueueSize` limitation will be rejected with an error:
     *      `CapacityLimiterError` with type 'queue-size-exceeded'.
     *
     * @throws {CapacityLimiterError} with types:
     * - `invalid-argument` - Invalid argument when calling the method.
     * - `max-capacity-exceeded` - Task capacity exceeds the maximum capacity.
     * - `queue-size-exceeded` - Task queue size exceeded.
     * - `queue-timeout` - Task queue waiting timeout.
     * - `execution-timeout` - Task execution timeout.
     * - `on-failure-error` - Task failed, then custom fail recovery strategy failed as well.
     * - `stopped` - Capacity limiter was stopped.
     *
     * @throws {Error} Task threw an error during execution.
     */
    schedule<TResult>(callback: () => Promise<TResult>): Promise<TResult>;
    schedule<TResult>(capacity: number, callback: () => Promise<TResult>): Promise<TResult>;
    schedule<TResult>(params: TaskParams<TResult>): Promise<TResult>;
    schedule(...args: unknown[]): Promise<unknown> {
        let resolve: (result: unknown) => void;
        let reject: (error: unknown) => void;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });

        let task: Task;
        const firstArg = args[0];
        const timeAdded = Date.now();
        if (typeof firstArg === 'object' && firstArg !== null) {
            const params = firstArg as TaskParams;
            if (typeof params.task !== 'function') {
                throw new CapacityLimiterError(
                    'invalid-argument',
                    'Invalid argument. Expected a function as the task.'
                );
            }
            task = {
                capacity: params.capacity ?? defaultCapacity,
                priority: params.priority ?? defaultPriority,
                timeAdded,
                callback: params.task,
                params,
                resolve: resolve!,
                reject: reject!,
                promise
            };
        } else {
            let fnPos = 0;
            let capacity: number | undefined;
            if (typeof firstArg === 'number') {
                fnPos = 1;
                capacity = firstArg;
            }
            const callback = args[fnPos] as () => Promise<unknown>;
            if (typeof callback !== 'function') {
                throw new CapacityLimiterError(
                    'invalid-argument',
                    `Invalid argument. Expected a function as the argument at position ${fnPos + 1}.`
                );
            }
            const taskArgs = args[fnPos + 1];
            if (taskArgs !== undefined) {
                if (!Array.isArray(taskArgs)) {
                    throw new CapacityLimiterError(
                        'invalid-argument',
                        `Invalid argument. Expected an Array as the task argument list at position ${fnPos + 2}.`
                    );
                }
            }
            task = {
                capacity: capacity ?? defaultCapacity,
                priority: defaultPriority,
                timeAdded,
                callback,
                params: {},
                resolve: resolve!,
                reject: reject!,
                promise
            };
        }

        this.scheduleTask(task);
        return promise;
    }

    /**
     * Stops the Capacity Limiter.
     * Doesn't accept any new tasks. Trying to schedule a new task will throw an error.
     * By default, it will wait for all tasks to finish and then stop.
     * This behavior can be changed by passing the `params` argument.
     */
    public stop(params?: StopParams): Promise<void> {
        params = params?.stopAll ? {stopWaitingTasks: true, rejectExecutingTasks: true, stopTaskRetries: true} : params;
        if (params && (params.stopWaitingTasks || params.rejectExecutingTasks || params.stopWaitingTasks)) {
            const error = new CapacityLimiterError('stopped', 'Capacity limiter was stopped. Tasks were rejected.');
            if (params.stopWaitingTasks) {
                this.queue.forEach((task) => task.reject(error));
                this.queue.clear();
                this.tasksByTimeAdded.clear();
                this.tasksByTimeLimit.clear();
            }
            if (params.rejectExecutingTasks) {
                this.executingTasks.forEach((task) => task.reject(error));
                this.executingTasks.clear();
            }
            if (params.stopTaskRetries) {
                this.failRecoveryManager.rejectAll(error);
            }
        }

        const promisesToAwait: Promise<unknown>[] = [];

        this.stopped = {};

        if (this.executingTasks.size > 0) {
            promisesToAwait.push(Promise.all(Array.from(this.executingTasks).map((task) => task.promise)));
        }

        const awaitingTasks = this.failRecoveryManager.getAwaitingTasks();
        if (awaitingTasks) {
            promisesToAwait.push(Promise.all(awaitingTasks.map((task) => task.promise)));
        }

        if (this.queue.length > 0) {
            if (!this.stopped.stoppedPromise) {
                this.stopped.stoppedPromise = new Promise<void>((resolve) => {
                    this.stopped!.stoppedResolve = resolve;
                });
            }
            promisesToAwait.push(this.stopped.stoppedPromise);
            this.startNextTaskIfPossible();
        }

        return Promise.all(promisesToAwait).then(() => {});
    }
}
