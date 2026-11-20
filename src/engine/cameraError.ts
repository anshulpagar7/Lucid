// Turns getUserMedia / getDisplayMedia failures into instructions a person can act on.

export function cameraError(e: unknown): string {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return `The camera only works on a secure address. Open http://localhost:${location.port || "5173"} instead of ${location.host}.`;
  }
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission is blocked. Click the camera icon in the address bar, choose Allow, then press Retry.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is being used by another app (Zoom, Teams, Meet, the Windows Camera app or another tab). Close it, then press Retry.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found. Plug in a webcam or enable it in Windows Settings → Privacy & security → Camera, then press Retry.";
    default:
      return `The camera couldn't start${e instanceof Error && e.message ? ` (${e.message})` : ""}. Check that no other app is using it, then press Retry.`;
  }
}
