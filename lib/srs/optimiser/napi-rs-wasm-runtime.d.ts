// @napi-rs/wasm-runtime ships no typings; it re-exports these from packages
// that do. `WASI` is the @tybys/wasm-util class, typed here as the emnapi
// instance it is passed as (their `start()` return types differ upstream).
declare module "@napi-rs/wasm-runtime" {
  export { instantiateNapiModuleSync, MessageHandler } from "@emnapi/core";
  export { getDefaultContext } from "@emnapi/runtime";
  export const WASI: new (options: { version: "preview1" }) => import("@emnapi/core").WASIInstance;
}
