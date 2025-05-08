type CapacityLimiterErrorType =
    | 'invalid-argument'
    | 'invalid-call'
    | 'max-capacity-exceeded'
    | 'queue-size-exceeded'
    | 'queue-timeout'
    | 'execution-timeout'
    | 'on-failure-error'
    | 'stopped';

export class CapacityLimiterError extends Error {
    public readonly type: CapacityLimiterErrorType;
    public readonly originalError?: unknown;
    constructor(type: CapacityLimiterErrorType, message: string, originalError?: unknown) {
        super(message);
        this.name = 'CapacityLimiterError';
        this.type = type;
        this.originalError = originalError;
        Object.setPrototypeOf(this, CapacityLimiterError.prototype);
    }
}
