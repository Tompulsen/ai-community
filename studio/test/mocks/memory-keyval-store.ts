type Hooks = {
  write?: (entries: [IDBValidKey, unknown][]) => Promise<void>;
  remove?: (keys: IDBValidKey[]) => Promise<void>;
};

/** Model the shared, serial transaction boundary used by idb-keyval. */
export function createMemoryKeyvalStore(
  records: Map<string, unknown>,
  hooks: Hooks = {},
) {
  let tail = Promise.resolve();
  return <T>(
    _mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => T | PromiseLike<T>,
  ): Promise<T> => {
    const result = tail.then(() => {
      const staged = new Map(records);
      const puts = new Map<IDBValidKey, unknown>();
      const deletes = new Set<IDBValidKey>();
      let pending = 0;
      let finishing = false;
      let aborted = false;
      const transaction = {
        error: null as Error | null,
        oncomplete: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        abort() {
          aborted = true;
          void Promise.resolve().then(() => transaction.onabort?.());
        },
      };
      const finish = () => {
        if (pending || finishing || aborted) return;
        finishing = true;
        void Promise.resolve()
          .then(async () => {
            if (puts.size) await hooks.write?.([...puts]);
            if (deletes.size) await hooks.remove?.([...deletes]);
            if (aborted) return;
            records.clear();
            for (const [key, value] of staged) records.set(key, value);
            transaction.oncomplete?.();
          })
          .catch((error: Error) => {
            transaction.error = error;
            transaction.abort();
          });
      };
      const request = <R>(action: () => R) => {
        pending++;
        const request = {
          result: undefined as R | undefined,
          onsuccess: undefined as (() => void) | undefined,
        };
        void Promise.resolve().then(() => {
          if (!aborted) {
            request.result = action();
            request.onsuccess?.();
          }
          pending--;
          finish();
        });
        return request;
      };
      const store = {
        transaction,
        get: (key: IDBValidKey) => request(() => staged.get(String(key))),
        getKey: (key: IDBValidKey) =>
          request(() => (staged.has(String(key)) ? key : undefined)),
        put: (value: unknown, key: IDBValidKey) =>
          request(() => {
            staged.set(String(key), value);
            puts.set(key, value);
            deletes.delete(key);
            return key;
          }),
        delete: (key: IDBValidKey) =>
          request(() => {
            staged.delete(String(key));
            deletes.add(key);
            puts.delete(key);
          }),
      } as unknown as IDBObjectStore;
      const completion = callback(store);
      finish();
      return completion;
    });
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };
}
