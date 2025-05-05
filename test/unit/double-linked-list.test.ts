import {DoubleLinkedList} from '../../src/double-linked-list.js';

/**
 * Unit tests for the DoubleLinkedList class.
 * These tests verify the basic functionality of the doubly linked list implementation
 * used by the CapacityLimiter for task queue management.
 */
describe('DoubleLinkedList', () => {
    let list: DoubleLinkedList<number>;

    beforeEach(() => {
        list = new DoubleLinkedList<number>();
    });

    describe('basic operations', () => {
        it('should initialize an empty list', () => {
            expect(list.length).toBe(0);
            expect(list.peekFirst()).toBeUndefined();
            expect(list.peekLast()).toBeUndefined();
        });

        it('should push items to the end of the list', () => {
            list.push(1);
            list.push(2);
            expect(list.length).toBe(2);
            expect(list.peekFirst()).toBe(1);
            expect(list.peekLast()).toBe(2);
        });

        it('should clear all items from the list', () => {
            list.push(1);
            list.push(2);
            list.clear();
            expect(list.length).toBe(0);
            expect(list.peekFirst()).toBeUndefined();
        });
    });

    describe('putAfter method', () => {
        it('should add item to an empty list', () => {
            list.putAfter(1, () => false);
            expect(list.peekFirst()).toBe(1);
            expect(list.length).toBe(1);
        });

        it('should add item to the beginning if no match', () => {
            list.putAfter(1, () => false);
            list.putAfter(2, () => false);
            expect(list.shift()).toBe(2);
            expect(list.shift()).toBe(1);
            expect(list.length).toBe(0);
        });

        it('should add item after the matching item', () => {
            list.putAfter(1, () => false);
            list.putAfter(2, (v) => v === 1);
            list.putAfter(3, () => false);
            expect(list.shift()).toBe(3);
            expect(list.shift()).toBe(1);
            expect(list.shift()).toBe(2);
        });

        it('should add item after the last matching item', () => {
            list.push(1);
            list.push(2);
            list.putAfter(3, (v) => v < 2);
            expect(list.shift()).toBe(1);
            expect(list.shift()).toBe(3);
            expect(list.shift()).toBe(2);
        });
    });

    describe('putBefore method', () => {
        it('should add item to an empty list', () => {
            list.putBefore(1, () => false);
            expect(list.peekFirst()).toBe(1);
            expect(list.length).toBe(1);
        });

        it('should add item to the end if no match', () => {
            list.putBefore(1, () => false);
            list.putBefore(2, () => false);
            expect(list.shift()).toBe(1);
            expect(list.shift()).toBe(2);
        });

        it('should add item before the matching item', () => {
            list.push(1);
            list.push(3);
            list.putBefore(2, (v) => v === 3);
            expect(list.shift()).toBe(1);
            expect(list.shift()).toBe(2);
            expect(list.shift()).toBe(3);
        });

        it('should add item before the first matching item', () => {
            list.push(1);
            list.push(3);
            list.push(3);
            list.putBefore(2, (v) => v === 3);
            expect(list.shift()).toBe(1);
            expect(list.shift()).toBe(2);
            expect(list.shift()).toBe(3);
            expect(list.shift()).toBe(3);
        });
    });

    describe('pickFirstMatching method', () => {
        it('should return undefined for empty list', () => {
            expect(list.pickFirstMatching(() => true)).toBeUndefined();
        });

        it('should return undefined if no match', () => {
            list.putAfter(1, () => false);
            list.putAfter(2, () => false);
            expect(list.pickFirstMatching((v) => v === 3)).toBeUndefined();
        });

        it('should remove and return the first matching item', () => {
            list.putAfter(1, () => false);
            list.putAfter(2, () => false);
            list.putAfter(3, () => false);
            expect(list.pickFirstMatching((v) => v === 2)).toBe(2);
            expect(list.shift()).toBe(3);
            expect(list.shift()).toBe(1);
            expect(list.length).toBe(0);
        });
    });

    describe('pickLastMatching method', () => {
        it('should return undefined for empty list', () => {
            expect(list.pickLastMatching(() => true)).toBeUndefined();
        });

        it('should return undefined if no match', () => {
            list.putAfter(1, () => false);
            list.putAfter(2, () => false);
            expect(list.pickLastMatching((v) => v === 3)).toBeUndefined();
        });

        it('should remove and return the last matching item', () => {
            list.push(1);
            list.push(2);
            list.push(3);
            list.push(4);
            expect(list.pickLastMatching((v) => v === 2)).toBe(2);
            expect(list.shift()).toBe(1);
            expect(list.shift()).toBe(3);
            expect(list.shift()).toBe(4);
        });

        it('should handle multiple matching items correctly', () => {
            list.push(1);
            list.push(2);
            list.push(2);
            list.push(3);
            expect(list.pickLastMatching((v) => v === 2)).toBe(2);
            expect(list.shift()).toBe(1);
            expect(list.shift()).toBe(2);
            expect(list.shift()).toBe(3);
        });
    });

    describe('shift method', () => {
        it('should return undefined for empty list', () => {
            expect(list.shift()).toBeUndefined();
        });

        it('should remove and return the first item', () => {
            list.putAfter(1, () => false);
            list.putAfter(2, () => false);
            expect(list.shift()).toBe(2);
            expect(list.shift()).toBe(1);
            expect(list.shift()).toBeUndefined();
            expect(list.length).toBe(0);
        });

        it('should update length property', () => {
            list.push(1);
            list.push(2);
            expect(list.length).toBe(2);
            list.shift();
            expect(list.length).toBe(1);
            list.shift();
            expect(list.length).toBe(0);
        });
    });

    describe('peek methods', () => {
        it('should return undefined for empty list', () => {
            expect(list.peekFirst()).toBeUndefined();
            expect(list.peekLast()).toBeUndefined();
        });

        it('should return the first item without removing it', () => {
            list.putAfter(1, () => false);
            expect(list.peekFirst()).toBe(1);
            expect(list.peekFirst()).toBe(1);
            expect(list.length).toBe(1);
        });

        it('should return the last item without removing it', () => {
            list.push(1);
            list.push(2);
            expect(list.peekLast()).toBe(2);
            expect(list.peekLast()).toBe(2);
            expect(list.length).toBe(2);
        });

        it('should handle a single item list correctly', () => {
            list.push(1);
            expect(list.peekFirst()).toBe(1);
            expect(list.peekLast()).toBe(1);
        });
    });

    describe('delete method', () => {
        it('should do nothing for empty list', () => {
            list.delete(1);
            expect(list.peekFirst()).toBeUndefined();
            expect(list.length).toBe(0);
        });

        it('should do nothing if value not found', () => {
            list.putAfter(1, () => false);
            list.delete(2);
            expect(list.peekFirst()).toBe(1);
            expect(list.length).toBe(1);
        });

        it('should remove the specified value', () => {
            list.putAfter(1, () => false);
            list.putAfter(2, () => false);
            list.putAfter(3, () => false);
            list.delete(2);
            expect(list.shift()).toBe(3);
            expect(list.shift()).toBe(1);
            expect(list.length).toBe(0);
        });

        it('should remove the first value', () => {
            list.putAfter(1, () => false);
            list.putAfter(2, () => false);
            list.delete(2);
            expect(list.shift()).toBe(1);
            expect(list.length).toBe(0);
        });

        it('should remove the last value', () => {
            list.putAfter(1, () => false);
            list.putAfter(2, () => false);
            list.delete(1);
            expect(list.shift()).toBe(2);
            expect(list.shift()).toBeUndefined();
            expect(list.length).toBe(0);
        });

        it('should update length property', () => {
            list.push(1);
            list.push(2);
            list.push(3);
            expect(list.length).toBe(3);
            list.delete(2);
            expect(list.length).toBe(2);
        });
    });

    describe('forEach method', () => {
        it('should do nothing for empty list', () => {
            const mockCallback = jest.fn();
            list.forEach(mockCallback);
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it('should call the callback for each item in the list', () => {
            list.push(1);
            list.push(2);
            list.push(3);

            const mockCallback = jest.fn();
            list.forEach(mockCallback);

            expect(mockCallback).toHaveBeenCalledTimes(3);
            expect(mockCallback).toHaveBeenNthCalledWith(1, 1);
            expect(mockCallback).toHaveBeenNthCalledWith(2, 2);
            expect(mockCallback).toHaveBeenNthCalledWith(3, 3);
        });

        it('should allow modifying the list during iteration', () => {
            list.push(1);
            list.push(2);
            list.push(3);

            const itemsProcessed: number[] = [];
            list.forEach((item) => {
                itemsProcessed.push(item);
                if (item === 2) {
                    list.delete(3);
                }
            });

            expect(itemsProcessed).toEqual([1, 2]);
            expect(list.length).toBe(2);
        });
    });
});
