#pragma once

// Applies the physical dual-Neon off state for the explicit local screen
// action that closes the Dock chat session. Network-loss handling stays
// independent and keeps its own waiting/error indication.
void stackchan_local_dock_user_disconnect_led_off();

// Speaker mode projects an input-only mute locally. It must not imply that
// the authenticated Dock session or speaker output was disconnected.
void stackchan_local_dock_input_muted_led_off();
void stackchan_local_dock_input_unmuted_led_connected();

// Replaces the official StackChan display's single-index green transition
// only when a Dock connection first becomes Listening.
void stackchan_local_dock_connected_led_green();
