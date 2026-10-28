// Small stand-ins for newer JavaScript features that older iPhones (iOS 15–16.3)
// don't have but the map library uses. Loaded first, in the page and in the map worker.

if (!Object.hasOwn) {
  Object.defineProperty(Object, "hasOwn", {
    value: (obj: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, key),
    configurable: true,
    writable: true,
  });
}

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    value: function at<T>(this: T[], i: number) {
      const n = Math.trunc(i) || 0;
      return this[n < 0 ? this.length + n : n];
    },
    configurable: true,
    writable: true,
  });
}

export {};
