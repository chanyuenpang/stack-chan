let runtime = null;
export function setQQBotRuntime(next) {
    runtime = next;
}
export function getQQBotRuntime() {
    if (!runtime) {
        throw new Error("QQBot runtime not initialized");
    }
    return runtime;
}
