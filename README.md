# Capacity Limiter

![npm version](https://img.shields.io/npm/v/capacity-limiter)
![license](https://img.shields.io/npm/l/capacity-limiter)
![build status](https://img.shields.io/github/actions/workflow/status/mdevils/capacity-limiter/build.yml?branch=main)

A powerful, flexible task scheduler and rate limiter based on resource capacity.
Efficiently manage task execution in JavaScript and TypeScript applications.

## Features

- **Capacity-Based Task Scheduling**: Control resource usage with user-defined capacity units
- **Priority Queueing**: Prioritize important tasks when resources are limited
- **Flexible Task Configuration**: Fully configurable tasks with timeout, priority, and capacity options
- **Rich Queue Management**: Control queue size and behavior when capacity is exceeded
- **Customizable Capacity Strategies**: Choose between `reserve` (temporary) and `claim` (lasting) capacity usage
- **Built-in Timeout Handling**: Automatically handle execution timeouts and queue waiting timeouts
- **Retry and Recovery**: Sophisticated retry strategies for failed tasks
- **Release Rules**: Configure automated capacity release with time-based rules
- **Comprehensive TypeScript Support**: Fully typed with detailed type definitions

## Installation

```bash
npm install capacity-limiter
# or
yarn add capacity-limiter
# or
pnpm add capacity-limiter
```

## Quick Start

```typescript
import { CapacityLimiter } from 'capacity-limiter';

// Create a capacity limiter with a maximum capacity of 10 units
const limiter = new CapacityLimiter({ maxCapacity: 10 });

// Schedule tasks with specific capacity requirements
async function runTasks() {
  // Run a small task (uses 2 capacity units out of 10)
  await limiter.schedule(2, async () => {
    console.log('Small task running');
    await someAsyncOperation();
  });

  // Large task will be queued if not enough capacity is available (current capacity is 8)
  const largeTaskPromise = limiter.schedule(9, async () => {
    console.log('Large task running - may wait for capacity');
    await largeAsyncOperation();
  });

  // Run a medium task (uses 5 capacity units)
  await limiter.schedule(5, async () => {
    console.log('Medium task running');
    await someOtherAsyncOperation();
  });
  
  await largeTaskPromise;
}

runTasks();
```

## Core Concepts

### Capacity

Capacity represents abstract resource units (CPU, memory, network, etc.) that tasks consume.
You define what a unit means in your context - it could be memory in MB, API requests, database connections, etc.

### Task Scheduling

Tasks are scheduled with a specified capacity requirement.
If there's enough available capacity, tasks execute immediately.
Otherwise, they're queued until capacity becomes available.

### Capacity Strategies

- **Reserve**: Capacity is temporarily reserved during task execution and released afterward (default)
- **Claim**: Capacity is claimed and remains used after task completion (useful for allocations)

### Queue Size Exceeded Strategies

When `maxQueueSize` is set and exceeded, the limiter uses one of these strategies:

- **throw-error**: Reject new tasks with a `CapacityLimiterError` when the queue is full (default)
- **replace**: Remove the oldest task from the queue to make room for the new task
- **replace-by-priority**: Compare priorities and replace the lowest priority task in the queue if the new task has higher priority

### Task Exceeds Max Capacity Strategies

When a task requires more capacity than `maxCapacity`:

- **throw-error**: Reject the task immediately with a `CapacityLimiterError` (default)
- **wait-for-full-capacity**: Allow the task to be scheduled, but wait until all capacity is available (zero used capacity) before executing it

## Advanced Usage

### Object-Style Configuration

```typescript
const result = await limiter.schedule({
  task: async () => {
    // Your task implementation
    return 'task result';
  },
  capacity: 5,         // Amount of capacity required
  priority: 1,         // Priority (0-9, lower is higher priority)
  queueWaitingLimit: 1000,   // Prioritize after waiting 1000ms
  queueWaitingTimeout: 2000, // Fail if waiting over 2000ms in queue
  executionTimeout: 3000,    // Fail if execution takes over 3000ms
});
```

### Release Rules

```typescript
const limiter = new CapacityLimiter({
  maxCapacity: 100,
  capacityStrategy: 'claim',
  releaseRules: [
    // Reset capacity to zero every hour
    { type: 'reset', interval: 60 * 60 * 1000 },
    // Reduce capacity by 10 units every minute
    { type: 'reduce', value: 10, interval: 60 * 1000 },
  ],
});
```

### Retry Strategies

```typescript
const simpleRetryLimiter = new CapacityLimiter({
  maxCapacity: 10,
  failRecoveryStrategy: 'retry',
});

const configuredRetryLimiter = new CapacityLimiter({
  maxCapacity: 10,
  failRecoveryStrategy: {
      type: 'retry',
      retries: 3, // Number of retries
      minTimeout: 1000, // Minimum timeout between retries
      maxTimeout: 5000, // Maximum timeout between retries
      randomize: true, // Randomize the timeout between min and max
      factor: 2, // Exponential backoff factor
  },
});

const customRetryLimiter = new CapacityLimiter({
  maxCapacity: 10,
  failRecoveryStrategy: {
      type: 'custom',
      retry: async (error, attempt) => {
          // Custom retry logic
          if (String(error).includes('Rate limit exceeded') && attempt < 3) {
              console.log(`Retrying... Attempt ${attempt}`);
              return {
                  type: 'retry',
                  timeout: 1000 * Math.pow(2, attempt), // Exponential backoff
              };
          }
          // Do not retry
          return {
              type: 'throw-error',
              error
          };
      },
  },
});
```

### Queue Management

```typescript
// Set queue size limit and behavior
const limiter = new CapacityLimiter({
  maxCapacity: 10,
  maxQueueSize: 100,  // Limit queue to 100 tasks
  queueSizeExceededStrategy: 'replace-by-priority', // Strategy when queue is full
  
  // Optional timeouts for queued tasks
  queueWaitingLimit: 500,    // Tasks waiting over 500ms get highest priority
  queueWaitingTimeout: 5000, // Tasks waiting over 5000ms are rejected
});

// Handle task capacity exceeding max capacity
const bigTaskLimiter = new CapacityLimiter({
  maxCapacity: 10,
  taskExceedsMaxCapacityStrategy: 'wait-for-full-capacity', // Wait for all capacity to be free
});
```

### Stopping the Limiter

```typescript
// Wait for all tasks to complete
await limiter.stop();

// Reject waiting tasks but allow executing tasks to complete
await limiter.stop({ stopWaitingTasks: true });

// Reject all tasks, including those currently executing
await limiter.stop({ stopWaitingTasks: true, rejectExecutingTasks: true });
```

## API Reference

### `CapacityLimiter`

```typescript
constructor(options: CapacityLimiterOptions)
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxCapacity` | `number` | (required) | Maximum capacity that can be used |
| `initiallyUsedCapacity` | `number` | `0` | Initial capacity already in use |
| `capacityStrategy` | `'reserve' \| 'claim'` | `'reserve'` | How capacity is managed |
| `releaseRules` | `ReleaseRule[]` | `[]` | Rules for releasing capacity |
| `taskExceedsMaxCapacityStrategy` | `'throw-error' \| 'wait-for-full-capacity'` | `'throw-error'` | Strategy when task exceeds max capacity |
| `maxConcurrent` | `number` | (unlimited) | Maximum concurrent tasks |
| `maxQueueSize` | `number` | (unlimited) | Maximum queue size |
| `queueSizeExceededStrategy` | `'throw-error' \| 'replace' \| 'replace-by-priority'` | `'throw-error'` | Strategy when queue size is exceeded |
| `queueWaitingLimit` | `number` | (unlimited) | Max queue waiting time before prioritization |
| `queueWaitingTimeout` | `number` | (unlimited) | Max queue waiting time before failure |
| `executionTimeout` | `number` | (unlimited) | Max execution time |
| `failRecoveryStrategy` | `FailRecoveryStrategy` | `'none'` | Strategy for recovering from failures |

### Methods

#### `schedule`

```typescript
// Basic scheduling with default capacity
schedule<TResult>(callback: () => Promise<TResult>): Promise<TResult>;

// Scheduling with specified capacity
schedule<TResult>(capacity: number, callback: () => Promise<TResult>): Promise<TResult>;

// Scheduling with full configuration
schedule<TResult>(params: TaskParams<TResult>): Promise<TResult>;
```

#### Other Methods

```typescript
// Get current options
getOptions(): CapacityLimiterOptions;

// Set/update options
setOptions(options: CapacityLimiterOptions): void;

// Get current used capacity
getUsedCapacity(): Promise<number>;

// Set used capacity
setUsedCapacity(usedCapacity: number): Promise<void>;

// Modify used capacity relatively
modifyUsedCapacity(diff: number): Promise<void>;

// Stop the limiter
stop(params?: StopParams): Promise<void>;
```

## Use Cases

- **API Rate Limiting**: Respect API quota limits by scheduling requests within capacity
- **Resource Intensive Operations**: Manage memory or CPU usage for heavy computations
- **Database Connection Pooling**: Control number of concurrent database operations
- **Worker Queues**: Manage task throughput based on worker capacity
- **Network Request Management**: Throttle network requests to avoid overload
- **Batch Processing**: Control parallelism for optimal resource usage

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

If you find this package helpful, consider [sponsoring the author](https://github.com/sponsors/mdevils) or [becoming a patron](https://patreon.com/mdevils).
