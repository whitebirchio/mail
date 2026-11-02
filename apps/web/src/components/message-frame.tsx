"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One message body in a sandboxed frame (SPEC.md, Security model 5b). Never
 * allow-scripts: nothing in an email runs. allow-same-origin is there only so
 * this parent can measure the content and size the frame to fit.
 */
export function MessageFrame({ document: srcDoc, title }: { document: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (doc?.documentElement) setHeight(Math.max(40, doc.documentElement.scrollHeight));
    };
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (body) {
        observer?.disconnect();
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
      // Late-loading images change the height.
      for (const img of Array.from(frame.contentDocument?.images ?? [])) img.addEventListener("load", measure);
    };
    frame.addEventListener("load", onLoad);
    if (frame.contentDocument?.readyState === "complete") onLoad();
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={{ height }}
      className="block w-full rounded-md border-0 bg-white"
    />
  );
}
