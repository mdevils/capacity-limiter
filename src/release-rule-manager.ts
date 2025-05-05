/**
 * Capacity Limiter Release Rule.
 */
export type ReleaseRule =
    | {
          /** Used capacity will be reset after the specified time. */
          type: 'reset';
          /** Reset value. Default is 0. */
          value?: number;
          /** Reser interval in milliseconds. */
          interval: number;
      }
    | {
          /** Used capacity will be reduced by the specified value after the specified time. */
          type: 'reduce';
          /** Reduce value. */
          value: number;
          /** Reduce interval in milliseconds. */
          interval: number;
      };

interface ReleaseRuleStatus {
    timerId?: ReturnType<typeof setTimeout>;
    intervalId?: ReturnType<typeof setInterval>;
    lastApplied: number;
}

export class ReleaseRuleManager {
    protected releaseTimers: Map<ReleaseRule, ReleaseRuleStatus> = new Map();
    protected releaseRuleTimersEnabled = false;
    protected applyRule: (rule: ReleaseRule, times: number) => void;
    protected applyCapacity: () => void;
    protected canReduceCapacity: () => boolean;

    constructor({
        applyRule,
        applyCapacity,
        canReduceCapacity
    }: {
        applyRule(rule: ReleaseRule, times: number): void;
        applyCapacity(): void;
        canReduceCapacity(): boolean;
    }) {
        this.applyRule = applyRule;
        this.applyCapacity = applyCapacity;
        this.canReduceCapacity = canReduceCapacity;
    }

    /**
     * Updates the release rules.
     */
    public setRules(releaseRules: ReleaseRule[]) {
        const lastApplied = Date.now();
        for (const rule of releaseRules) {
            if (this.releaseTimers.has(rule)) {
                continue;
            }
            const status: ReleaseRuleStatus = {lastApplied};
            this.releaseTimers.set(rule, status);
            if (this.releaseRuleTimersEnabled) {
                this.setRuleTimerWithDelay(rule, status, rule.interval);
            }
        }
        const newRulesSet = new Set(releaseRules);
        for (const [rule, status] of Array.from(this.releaseTimers.entries())) {
            if (!newRulesSet.has(rule)) {
                this.clearReleaseRuleTimer(status);
                this.releaseTimers.delete(rule);
            }
        }
    }

    protected applyRuleByInterval(rule: ReleaseRule, status: ReleaseRuleStatus) {
        status.lastApplied = Date.now();
        this.applyRule(rule, 1);
        this.applyCapacity();
    }

    protected clearReleaseRuleTimer(status: ReleaseRuleStatus) {
        if (status.timerId) {
            clearTimeout(status.timerId);
            status.timerId = undefined;
        }
        if (status.intervalId) {
            clearInterval(status.intervalId);
            status.intervalId = undefined;
        }
    }

    protected setRuleTimerWithDelay(rule: ReleaseRule, status: ReleaseRuleStatus, delay: number) {
        if (delay === rule.interval) {
            status.intervalId = setInterval(() => this.applyRuleByInterval(rule, status), rule.interval);
        } else {
            status.timerId = setTimeout(() => {
                status.timerId = undefined;
                status.intervalId = setInterval(() => this.applyRuleByInterval(rule, status), rule.interval);
                this.applyRuleByInterval(rule, status);
            }, delay);
        }
    }

    /**
     * Applies the rules which were not applied during the time the timers were disabled.
     */
    public applyMissedRules(now: number) {
        let lastResetTime: number | undefined;
        let lastResetTimeRule: ReleaseRule | undefined;
        for (const [rule, status] of Array.from(this.releaseTimers.entries())) {
            if (rule.type === 'reset') {
                if (now - status.lastApplied >= rule.interval) {
                    const resetTime = now - ((now - status.lastApplied) % rule.interval);
                    if (!lastResetTime || resetTime > lastResetTime) {
                        lastResetTime = resetTime;
                        lastResetTimeRule = rule;
                    }
                    status.lastApplied = resetTime;
                }
            }
        }

        if (lastResetTimeRule) {
            this.applyRule(lastResetTimeRule, 1);
        }

        for (const [rule, status] of Array.from(this.releaseTimers.entries())) {
            if (rule.type === 'reduce') {
                if (now - status.lastApplied >= rule.interval) {
                    const lastReduceTime = now - ((now - status.lastApplied) % rule.interval);
                    if (this.canReduceCapacity()) {
                        const timesApplied = Math.floor(
                            (lastReduceTime - (lastResetTime ?? status.lastApplied)) / rule.interval
                        );
                        this.applyRule(rule, timesApplied);
                    }
                    status.lastApplied = lastReduceTime;
                }
            }
        }
    }

    /**
     * Enables the timers for the release rules.
     */
    public enableTimers() {
        if (this.releaseRuleTimersEnabled) {
            return;
        }

        this.releaseRuleTimersEnabled = true;

        const now = Date.now();

        this.applyMissedRules(now);

        for (const [rule, status] of Array.from(this.releaseTimers.entries())) {
            this.setRuleTimerWithDelay(rule, status, rule.interval - (now - status.lastApplied));
        }
    }

    /**
     * Disables the timers for the release rules.
     */
    public disableTimers() {
        if (!this.releaseRuleTimersEnabled) {
            return;
        }

        this.releaseRuleTimersEnabled = false;

        for (const status of Array.from(this.releaseTimers.values())) {
            this.clearReleaseRuleTimer(status);
        }
    }

    public areTimersEnabled() {
        return this.releaseRuleTimersEnabled;
    }
}
