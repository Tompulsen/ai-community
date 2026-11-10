import * as keyval from "idb-keyval";

let database: ReturnType<typeof keyval.createStore> | undefined;
export const studioStore: ReturnType<typeof keyval.createStore> = (mode, callback) => {
  database ??= keyval.createStore("community-studio", "keyval");
  return database(mode, callback);
};
export const get = <T>(key: IDBValidKey) => keyval.get<T>(key, studioStore);
export const set = (key: IDBValidKey, value: unknown) => keyval.set(key, value, studioStore);
export const del = (key: IDBValidKey) => keyval.del(key, studioStore);
export const clear = () => keyval.clear(studioStore);
