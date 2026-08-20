"use client";

import * as React from "react";
import { isLiveScanCaptureDevice } from "../../lib/live-scan-device";

/** Desktop may review a live result, but only a mobile camera may capture it. */
export function useLiveScanCaptureDevice(): { supported: boolean; loading: boolean } {
  const [supported, setSupported] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setSupported(isLiveScanCaptureDevice(window.navigator));
    setLoading(false);
  }, []);

  return { supported, loading };
}
