/**
 * Linked list item.
 */
interface DoubleLinkedListNode<T> {
    value: T;
    next?: DoubleLinkedListNode<T>;
    prev?: DoubleLinkedListNode<T>;
}

/**
 * Double linked list with a non-standard API.
 * Optimized to be used for priority queues.
 */
export class DoubleLinkedList<T> {
    protected head?: DoubleLinkedListNode<T>;
    protected tail?: DoubleLinkedListNode<T>;
    public length = 0;
    protected map = new Map<T, DoubleLinkedListNode<T>>();

    /**
     * Puts a value in the list after the last value that matches the condition.
     */
    putAfter(value: T, condition: (value: T) => boolean) {
        this.length++;

        const node: DoubleLinkedListNode<T> = {value};
        this.map.set(value, node);

        let current = this.tail;
        if (!current) {
            this.head = this.tail = node;
            return;
        }

        do {
            if (condition(current.value)) {
                if (current.next) {
                    current.next.prev = node;
                    node.next = current.next;
                } else {
                    this.tail = node;
                }
                node.prev = current;
                current.next = node;
                return;
            }
            current = current.prev;
        } while (current);

        this.head!.prev = node;
        node.next = this.head;
        this.head = node;
    }

    putBefore(value: T, condition: (value: T) => boolean) {
        this.length++;

        const node: DoubleLinkedListNode<T> = {value};
        this.map.set(value, node);

        let current = this.head;
        if (!current) {
            this.head = this.tail = node;
            return;
        }

        do {
            if (condition(current.value)) {
                if (current.prev) {
                    current.prev.next = node;
                    node.prev = current.prev;
                } else {
                    this.head = node;
                }
                node.next = current;
                current.prev = node;
                return;
            }
            current = current.next;
        } while (current);

        this.tail!.next = node;
        node.prev = this.tail;
        this.tail = node;
    }

    push(value: T) {
        this.length++;

        const node: DoubleLinkedListNode<T> = {value};
        this.map.set(value, node);

        if (!this.tail) {
            this.head = this.tail = node;
            return;
        }

        this.tail.next = node;
        node.prev = this.tail;
        this.tail = node;
    }

    /**
     * Removes and returns the first value that matches the condition.
     */
    pickFirstMatching(condition: (value: T) => boolean): T | undefined {
        let current = this.head;
        while (current) {
            if (condition(current.value)) {
                if (current.prev) {
                    current.prev.next = current.next;
                } else {
                    this.head = current.next;
                }
                if (current.next) {
                    current.next.prev = current.prev;
                } else {
                    this.tail = current.prev;
                }
                this.length--;
                this.map.delete(current.value);
                return current.value;
            }
            current = current.next;
        }
        return undefined;
    }

    /**
     * Removes and returns the last value that matches the condition.
     */
    pickLastMatching(condition: (value: T) => boolean): T | undefined {
        let current = this.tail;
        while (current) {
            if (condition(current.value)) {
                if (current.prev) {
                    current.prev.next = current.next;
                } else {
                    this.head = current.next;
                }
                if (current.next) {
                    current.next.prev = current.prev;
                } else {
                    this.tail = current.prev;
                }
                this.length--;
                this.map.delete(current.value);
                return current.value;
            }
            current = current.prev;
        }
        return undefined;
    }

    /**
     * Removes and returns the first value in the list.
     */
    shift(): T | undefined {
        if (!this.head) {
            return undefined;
        }
        const value = this.head.value;
        this.head = this.head.next;
        if (this.head) {
            this.head.prev = undefined;
        } else {
            this.tail = undefined;
        }
        this.length--;
        this.map.delete(value);
        return value;
    }

    /**
     * Returns the first value of the list without removing it.
     */
    peekFirst(): T | undefined {
        return this.head?.value;
    }

    /**
     * Returns the last value of the list without removing it.
     */
    peekLast(): T | undefined {
        return this.tail?.value;
    }

    /**
     * Removes and returns the last value in the list.
     */
    pop(): T | undefined {
        if (!this.tail) {
            return undefined;
        }
        const value = this.tail.value;
        this.tail = this.tail.prev;
        if (this.tail) {
            this.tail.next = undefined;
        } else {
            this.head = undefined;
        }
        this.length--;
        this.map.delete(value);
        return value;
    }

    /**
     * Deletes a value from the list.
     */
    delete(value: T) {
        const node = this.map.get(value);
        if (!node) {
            return;
        }
        this.length--;

        if (node.prev) {
            node.prev.next = node.next;
        } else {
            this.head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        } else {
            this.tail = node.prev;
        }
        this.map.delete(value);
    }

    forEach(callback: (value: T) => void) {
        let current = this.head;
        while (current) {
            callback(current.value);
            current = current.next;
        }
    }

    clear() {
        this.head = undefined;
        this.tail = undefined;
        this.length = 0;
        this.map.clear();
    }
}
