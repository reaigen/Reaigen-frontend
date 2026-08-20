export interface LiveScanNavigatorIdentity {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

/**
 * Capture is a product/device policy, not a camera probe. In particular, this
 * function never calls getUserMedia, so rendering Live Scan on desktop cannot
 * open or inspect a workstation camera.
 */
export function isLiveScanCaptureDevice(
  navigatorValue: LiveScanNavigatorIdentity,
): boolean {
  const userAgent = navigatorValue.userAgent || "";
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent);
  // Modern iPadOS identifies itself as macOS; multiple touch points separate
  // it from an actual Mac desktop browser.
  const ipadDesktopIdentity = navigatorValue.platform === "MacIntel"
    && Number(navigatorValue.maxTouchPoints || 0) > 1;
  return mobileUserAgent || ipadDesktopIdentity;
}
