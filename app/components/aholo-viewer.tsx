"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface AholoViewerProps {
  splatUrl: string;
  lang?: string;
  className?: string;
  onReady?: () => void;
  onError?: (msg: string) => void;
}

/**
 * Aholo-based Gaussian Splat viewer (prototype).
 * Uses @manycore/aholo-viewer for streaming SOG/SPZ/PLY rendering.
 * Runs alongside the existing BabylonJS viewer for A/B comparison.
 */
export function AholoViewer({ splatUrl, lang = "en", className = "", onReady, onError }: AholoViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const [status, setStatus] = useState("Initializing…");
  const [ready, setReady] = useState(false);
  const disposedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || !splatUrl) return;
    disposedRef.current = false;

    let viewer: any = null;
    let resizeCleanup: (() => void) | null = null;

    async function init() {
      try {
        const container = containerRef.current!;

        // Ensure container has real dimensions before creating viewer
        if (container.clientWidth === 0 || container.clientHeight === 0) {
          await new Promise((r) => requestAnimationFrame(r));
        }

        setStatus("Loading engine…");

        // Dynamic import to avoid SSR issues
        const aholo = await import("@manycore/aholo-viewer");
        if (disposedRef.current) return;

        setStatus("Creating viewer…");

        // Create viewer with container that has stable dimensions
        viewer = aholo.createViewer("reaigen-aholo", container, {
          antialiasing: true,
          alpha: false,
        });
        viewerRef.current = viewer;

        // Setup render loop — this is required for continuous rendering
        const render = () => viewer.render();
        viewer.requestRenderHandler = () => {
          rafRef.current = requestAnimationFrame(render);
        };
        requestAnimationFrame(render);

        // Setup camera
        const aspect = container.clientWidth / container.clientHeight || 16 / 9;
        const camera = new aholo.PerspectiveCamera(60, aspect, 0.1, 2000);
        // Y-up convention (matches our BabylonJS viewer)
        camera.up.set(0, 1, 0);
        camera.position.set(-3, 2, -3);
        camera.lookAt(new aholo.Vector3(0, 0, 0));
        viewer.setCamera(camera);

        // Configure pipeline — white background, splat rendering enabled
        try {
          aholo.setViewerConfig(viewer, {
            pipeline: {
              Background: {
                background: {
                  active: aholo.BackgroundMode?.BasicBackground ?? "basic",
                  basic: { color: new aholo.Color(1, 1, 1) },
                },
                ground: { enabled: false },
              },
              Splatting: { enabled: true },
              TAA: { enabled: false },
            },
          });
        } catch (e) {
          console.warn("[REAI/Aholo] Pipeline config error (non-fatal):", e);
        }

        // Handle resize
        const onResize = () => {
          if (!viewerRef.current || !containerRef.current) return;
          viewerRef.current.resize();
        };
        window.addEventListener("resize", onResize);
        resizeCleanup = () => window.removeEventListener("resize", onResize);

        // Detect file type from URL
        const urlPath = splatUrl.split("?")[0].toLowerCase();
        let fileType = aholo.SplatLoader.SplatFileType.SOG;
        if (urlPath.endsWith(".ply")) fileType = aholo.SplatLoader.SplatFileType.PLY;
        else if (urlPath.endsWith(".spz")) fileType = aholo.SplatLoader.SplatFileType.SPZ;
        else if (urlPath.endsWith(".splat")) fileType = aholo.SplatLoader.SplatFileType.SPLAT;

        setStatus("Downloading…");

        // Fetch the splat file
        const resp = await fetch(splatUrl, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
        const buffer = await resp.arrayBuffer();
        if (disposedRef.current) return;

        setStatus("Parsing…");

        // Parse splat data — parseSplatData uses Web Workers internally.
        // Default packType (SuperCompressed=2) works for all formats including SOG.
        const splatData = await aholo.SplatLoader.parseSplatData(
          fileType,
          new Uint8Array(buffer),
        );

        if (disposedRef.current) return;
        setStatus("Creating splat mesh…");

        const splat = await aholo.SplatUtils.createSplat(splatData);
        if (disposedRef.current) return;

        viewer.getScene().add(splat);

        setReady(true);
        setStatus("");
        onReady?.();
      } catch (err: any) {
        if (!disposedRef.current) {
          const msg = err?.message || String(err);
          setStatus(`Error: ${msg}`);
          onError?.(msg);
          console.error("[REAI/Aholo]", err);
        }
      }
    }

    init();

    return () => {
      disposedRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      resizeCleanup?.();
      if (viewerRef.current) {
        try {
          viewerRef.current.requestRenderHandler = undefined;
          viewerRef.current.pause();
        } catch {}
        viewerRef.current = null;
      }
    };
  }, [splatUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`absolute inset-0 ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && status && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="animate-spin h-5 w-5 border-2 border-white/30 border-t-white rounded-full" />
            <span className="text-xs text-white/80">{status}</span>
          </div>
        </div>
      )}
      {/* Dev badge */}
      <span className="absolute top-2 left-2 z-10 rounded bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold text-black uppercase tracking-wider">
        Aholo (dev)
      </span>
    </div>
  );
}
