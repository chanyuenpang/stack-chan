/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

namespace tools {

/**
 * @brief Trigger a 3-5 second celebration animation.
 * 
 * Non-blocking: returns immediately after starting the animation sequence.
 * The robot will:
 *   - Play a cheerful notification sound
 *   - Gently sway left and right (Happy dance modifier)
 *   - Gradually transition LED colors (breathing effect)
 * 
 * Call this from the self.robot.celebrate MCP tool handler.
 */
void celebrate();

}  // namespace tools
