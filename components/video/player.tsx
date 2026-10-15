"use client";
import { useId, useRef, useState } from "react";
import type { CreatorVideo } from "@/lib/video/types";
export function VideoPlayer({
  video,
  privatePreview = false,
}: {
  video: CreatorVideo | null | undefined;
  privatePreview?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const instanceId = useId();
  const [failed, setFailed] = useState(false),
    [waiting, setWaiting] = useState(false);
  if (!video) return null;
  if (video.state !== "ready")
    return (
      <p className="video-status" role="status">
        {video.error ||
          `Video ${video.state}. It remains private until processing and review finish.`}
      </p>
    );
  if (failed)
    return (
      <div className="video-status" role="status">
        Video unavailable. It may have been withdrawn or become inaccessible.
        <button className="text-link" onClick={() => setFailed(false)}>
          Try loading video again
        </button>
      </div>
    );
  const seconds = Math.ceil((video.durationMs || 0) / 1000),
    descriptionId = `video-description-${instanceId}`;
  return (
    <figure className="mimi-video">
      <video
        ref={ref}
        controls
        playsInline
        preload="none"
        poster={`/api/videos/${video.id}?variant=poster`}
        src={`/api/videos/${video.id}`}
        width={video.width || 1280}
        height={video.height || 720}
        aria-label={video.description}
        aria-describedby={descriptionId}
        onError={() => setFailed(true)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onPlay={(event) => {
          for (const other of document.querySelectorAll("video"))
            if (other !== event.currentTarget) other.pause();
        }}
      />
      {waiting && <p role="status">Loading video…</p>}
      <figcaption>
        <p id={descriptionId} className="creator-text">
          {video.description}
        </p>
        <div className="video-meta">
          <span>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} ·{" "}
            {privatePreview ? "Private preview" : "Community video"}
          </span>
          <button
            className="text-link"
            onClick={async () => {
              if (!ref.current) return;
              ref.current.muted = true;
              try {
                await ref.current.play();
              } catch {
                setFailed(true);
              }
            }}
          >
            Play muted preview
          </button>
        </div>
        {video.scanStatus === "development_manual" && (
          <p className="creator-help">
            Local development video · not content-scanned
          </p>
        )}
        {privatePreview && (
          <p className="creator-help">
            Playback is processed media. Scanning and staff approval are
            separate requirements.
          </p>
        )}
        {video.transcript && (
          <details>
            <summary>Creator transcript / audio description</summary>
            <p className="creator-text">{video.transcript}</p>
          </details>
        )}
      </figcaption>
    </figure>
  );
}
