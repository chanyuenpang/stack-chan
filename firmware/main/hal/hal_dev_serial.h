/*
 * Dev-only local serial control entry for StackChan/Xiaozhi PoC.
 *
 * The implementation is compiled only when STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP
 * is defined by CMake. Keep this disabled in regular firmware builds because it
 * exposes a local command that can open the microphone.
 */
#pragma once

void start_dev_serial_wake_stop_task();
