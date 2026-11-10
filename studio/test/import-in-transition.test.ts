import { jest } from "@jest/globals";
import React, { startTransition } from "react";
import { importInTransition } from "../app/utils/import-in-transition";

const batch = Reflect.get(
  React,
  "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
).ReactCurrentBatchConfig;

test("defers the loader into a fresh real React transition", async () => {
  let outerTransition: object | null = null;
  let result!: Promise<string>;
  const load = jest.fn(() => {
    expect(batch.transition).not.toBeNull();
    expect(batch.transition).not.toBe(outerTransition);
    return Promise.resolve("loaded");
  });
  expect(batch.transition).toBeNull();

  startTransition(() => {
    outerTransition = batch.transition;
    result = importInTransition(load);
    expect(load).not.toHaveBeenCalled();
  });

  expect(load).not.toHaveBeenCalled();
  expect(batch.transition).toBeNull();
  await expect(result).resolves.toBe("loaded");
  expect(load).toHaveBeenCalledTimes(1);
  expect(batch.transition).toBeNull();
});

test("adopts the loader's asynchronous resolved value", async () => {
  const value = { ready: true };
  const loading = Promise.resolve().then(() => value);

  await expect(importInTransition(() => loading)).resolves.toBe(value);
});

test("preserves the loader's asynchronous rejection", async () => {
  const error = new Error("Chunk unavailable");
  const loading = Promise.resolve().then(() => {
    throw error;
  });

  await expect(importInTransition(() => loading)).rejects.toBe(error);
});

test("turns a synchronous loader throw into a rejection", async () => {
  const error = new Error("Loader failed");
  const result = importInTransition(() => {
    throw error;
  });

  expect(batch.transition).toBeNull();
  await expect(result).rejects.toBe(error);
});
