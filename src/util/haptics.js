/**
 * Light tactile feedback utility using the Vibration API.
 * Provides subtle mobile touch feedback for key user interactions.
 * Safe fallback to no-op on desktop or unsupported devices.
 */

export function vibrate(pattern = 10) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignored if user has not interacted or device blocked vibration
    }
  }
}

export const haptic = {
  tap: () => vibrate(10),
  selection: () => vibrate(8),
  toggle: () => vibrate(12),
  success: () => vibrate([10, 40, 15]),
  warning: () => vibrate([30, 50, 30]),
};
