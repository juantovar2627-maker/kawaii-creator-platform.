import "server-only";
import { spawn } from "node:child_process";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { localDevelopment } from "@/lib/media/storage";
import { VIDEO_MAX } from "./storage";
export class VideoError extends Error {
  constructor(
    public code: string,
    public permanent = true,
  ) {
    super(code);
  }
}
export function processingMode() {
  const mode = process.env.VIDEO_SANDBOX_MODE || "bwrap";
  if (mode === "development-prlimit" && localDevelopment()) return mode;
  if (mode !== "bwrap") throw new VideoError("isolated_worker_required", false);
  return mode;
}
export async function fileHash(path: string) {
  const h = createHash("sha256");
  for await (const part of createReadStream(path)) h.update(part);
  return h.digest("hex");
}
// Parse only bounded ISO BMFF containers. Do not pass playlists, network URLs,
// reference movies, fragments or external data references into FFmpeg.
export async function validateContainer(path: string) {
  const info = await stat(path);
  if (info.size <= 0 || info.size > VIDEO_MAX)
    throw new VideoError("input_size");
  const bytes = await readFile(path);
  let count = 0,
    ftyp = 0,
    moov = 0,
    mdat = 0;
  const containers = new Set([
    "moov",
    "trak",
    "mdia",
    "minf",
    "stbl",
    "dinf",
    "edts",
    "udta",
    "meta",
    "dref",
  ]);
  function boxes(start: number, end: number, depth: number, parent = "") {
    if (depth > 12) throw new VideoError("container_nesting");
    let offset = start;
    while (offset < end) {
      if (++count > 10000 || end - offset < 8)
        throw new VideoError("container_structure");
      let size = bytes.readUInt32BE(offset),
        header = 8;
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (size === 1) {
        if (end - offset < 16) throw new VideoError("container_structure");
        const large = bytes.readBigUInt64BE(offset + 8);
        if (large > BigInt(end - offset))
          throw new VideoError("container_structure");
        size = Number(large);
        header = 16;
      }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end)
        throw new VideoError("container_structure");
      const begin = offset + header,
        stop = offset + size;
      if (
        [
          "moof",
          "mvex",
          "sidx",
          "rmra",
          "rmda",
          "rdrf",
          "urn ",
          "uuid",
        ].includes(type)
      )
        throw new VideoError("unsupported_media_structure");
      if (parent === "dref" && type !== "url ")
        throw new VideoError("external_media_reference");
      if (
        type === "url " &&
        (stop - begin < 4 || (bytes.readUInt32BE(begin) & 0xffffff) !== 1)
      )
        throw new VideoError("external_media_reference");
      if (depth === 0) {
        if (!["ftyp", "moov", "mdat", "free", "skip", "wide"].includes(type))
          throw new VideoError("unsupported_container");
        if (type === "ftyp") {
          ftyp++;
          if (
            stop - begin < 8 ||
            !["isom", "iso2", "mp41", "mp42", "avc1", "qt  ", "M4V "].includes(
              bytes.toString("ascii", begin, begin + 4),
            )
          )
            throw new VideoError("unsupported_container");
        }
        if (type === "moov") moov++;
        if (type === "mdat") mdat++;
      }
      if (containers.has(type)) {
        const skip = type === "meta" ? 4 : type === "dref" ? 8 : 0;
        if (begin + skip > stop) throw new VideoError("container_structure");
        boxes(begin + skip, stop, depth + 1, type);
      }
      offset = stop;
    }
  }
  boxes(0, bytes.length, 0);
  if (ftyp !== 1 || moov !== 1 || mdat < 1)
    throw new VideoError("unsupported_container");
}
function executable(kind: "ffmpeg" | "ffprobe") {
  const path =
    process.env[
      kind === "ffmpeg" ? "VIDEO_FFMPEG_PATH" : "VIDEO_FFPROBE_PATH"
    ] || `/usr/bin/${kind}`;
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(path))
    throw new VideoError("worker_binary_configuration", false);
  return path;
}
export async function runTool(
  kind: "ffmpeg" | "ffprobe",
  args: string[],
  input: string,
  output: string | null,
  signal: AbortSignal,
  seconds: number,
  cap = 1024 * 1024,
) {
  const mode = processingMode();
  const bin = executable(kind);
  const logicalInput = mode === "bwrap" ? "/work/source.bin" : input;
  const logicalOutput = mode === "bwrap" ? "/work/playback.mp4" : output;
  const actual = args.map((x) =>
    x === "@INPUT" ? logicalInput : x === "@OUTPUT" ? logicalOutput! : x,
  );
  const limits = [
    "--as=2147483648",
    `--cpu=${seconds}`,
    "--fsize=94371840",
    "--nofile=128",
    "--nproc=512",
    "--",
    bin,
    ...actual,
  ];
  let command = "/usr/bin/prlimit",
    argv = limits;
  if (output)
    await writeFile(output, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
  if (mode === "bwrap") {
    command = "/usr/bin/bwrap";
    argv = [
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--size",
      "67108864",
      "--tmpfs",
      "/tmp",
      "--size",
      "1048576",
      "--tmpfs",
      "/work",
      "--ro-bind",
      input,
      "/work/source.bin",
      ...(output ? ["--bind", output, "/work/playback.mp4"] : []),
      "--chdir",
      "/work",
      "--clearenv",
      "--setenv",
      "PATH",
      "/usr/bin",
      "--setenv",
      "LANG",
      "C",
      "/usr/bin/prlimit",
      ...limits,
    ];
  }
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, argv, {
      shell: false,
      detached: true,
      env: {
        NODE_ENV: "production",
        PATH: "/usr/bin",
        LANG: "C",
        HOME: "/nonexistent",
        OMP_NUM_THREADS: "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let out = 0,
      err = 0,
      finished = false,
      failure: Error | undefined;
    const kill = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const abort = () => {
      failure = new VideoError("worker_lease_or_timeout", false);
      kill();
    };
    const timer = setTimeout(abort, (seconds + 5) * 1000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", (b: Buffer) => {
      out += b.length;
      if (out > cap) {
        failure = new VideoError("worker_output_limit");
        kill();
      } else chunks.push(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      err += b.length;
      if (err > 65536) {
        failure = new VideoError("worker_diagnostic_limit");
        kill();
      }
    });
    const done = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(Buffer.concat(chunks));
    };
    child.on("error", () =>
      done(new VideoError("worker_runtime_unavailable", false)),
    );
    child.on("close", (code) =>
      done(
        failure ||
          (code === 0
            ? undefined
            : new VideoError(
                mode === "bwrap" ? "isolated_decode_failed" : "decode_failed",
                mode !== "bwrap",
              )),
      ),
    );
  });
}
const number = (value: unknown) =>
  typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : NaN;
const rate = (value: unknown) => {
  if (typeof value !== "string") return NaN;
  const [a, b = "1"] = value.split("/");
  return Number(a) / Number(b);
};
export type VideoInfo = {
  width: number;
  height: number;
  durationMs: number;
  frameRate: number;
  videoCodec: string;
  audioCodec: string | null;
};
export async function probe(
  path: string,
  signal: AbortSignal,
  output = false,
): Promise<VideoInfo> {
  const json = await runTool(
    "ffprobe",
    [
      "-v",
      "error",
      "-max_alloc",
      "16777216",
      "-protocol_whitelist",
      "file",
      "-format_whitelist",
      "mov",
      "-threads",
      "2",
      "-show_format",
      "-show_streams",
      "-show_chapters",
      "-of",
      "json",
      "-i",
      "@INPUT",
    ],
    path,
    null,
    signal,
    15,
  );
  let data;
  try {
    data = JSON.parse(json.toString("utf8"));
  } catch {
    throw new VideoError("probe_response");
  }
  if (
    !Array.isArray(data.streams) ||
    data.streams.length > 2 ||
    data.chapters?.length ||
    !String(data.format?.format_name).split(",").includes("mov")
  )
    throw new VideoError("unsupported_streams");
  const video = data.streams.filter(
      (s: { codec_type?: string }) => s.codec_type === "video",
    ),
    audio = data.streams.filter(
      (s: { codec_type?: string }) => s.codec_type === "audio",
    );
  if (
    video.length !== 1 ||
    audio.length > 1 ||
    video.length + audio.length !== data.streams.length
  )
    throw new VideoError("unsupported_streams");
  const v = video[0],
    a = audio[0],
    width = number(v.width),
    height = number(v.height),
    fps = rate(v.avg_frame_rate),
    declaredRate = rate(v.r_frame_rate);
  const duration = Math.max(
    number(data.format?.duration),
    number(v.duration) || 0,
    a ? number(a.duration) || 0 : 0,
  );
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > (output ? 60.1 : 60) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width > 1920 ||
    height > 1920 ||
    width * height > 1920 * 1080 ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    fps > 60 ||
    !Number.isFinite(declaredRate) ||
    declaredRate <= 0 ||
    declaredRate > 60 ||
    number(v.nb_frames) > 3600
  )
    throw new VideoError("duration_dimensions_or_frame_rate");
  if (
    !(output ? ["h264"] : ["h264", "hevc"]).includes(v.codec_name) ||
    v.disposition?.attached_pic
  )
    throw new VideoError("unsupported_video_codec");
  if (
    a &&
    (!["aac", "mp3", "pcm_s16le", "pcm_s24le"].includes(a.codec_name) ||
      number(a.channels) < 1 ||
      number(a.channels) > 2 ||
      number(a.sample_rate) < 8000 ||
      number(a.sample_rate) > 96000)
  )
    throw new VideoError("unsupported_audio_codec");
  if (
    output &&
    (number(v.duration) > 60 ||
      (a && a.codec_name !== "aac") ||
      Math.max(width, height) > 1280 ||
      Math.min(width, height) > 720 ||
      fps > 30.01)
  )
    throw new VideoError("invalid_playback_output");
  let rotation = number(v.tags?.rotate) || 0;
  for (const side of v.side_data_list || [])
    if (side.rotation !== undefined) rotation = number(side.rotation);
  if (!Number.isFinite(rotation) || rotation % 90 !== 0)
    throw new VideoError("unsupported_rotation");
  return {
    width: Math.abs(rotation) % 180 === 90 ? height : width,
    height: Math.abs(rotation) % 180 === 90 ? width : height,
    durationMs: Math.min(60000, Math.round(duration * 1000)),
    frameRate: Math.ceil(fps),
    videoCodec: v.codec_name,
    audioCodec: a?.codec_name || null,
  };
}
export async function processVideo(work: string, signal: AbortSignal) {
  const source = join(work, "source.bin"),
    playback = join(work, "playback.mp4"),
    poster = join(work, "poster.webp");
  await validateContainer(source);
  const input = await probe(source, signal);
  const landscape = input.width >= input.height;
  await runTool(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-xerror",
      "-err_detect",
      "explode",
      "-max_alloc",
      "16777216",
      "-protocol_whitelist",
      "file",
      "-format_whitelist",
      "mov",
      "-threads",
      "2",
      "-i",
      "@INPUT",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-vf",
      `scale=w='min(${landscape ? 1280 : 720},iw)':h='min(${landscape ? 720 : 1280},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
      "-r",
      String(Math.min(input.frameRate, 30)),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "24",
      "-maxrate",
      "2500k",
      "-bufsize",
      "5000k",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "2",
      "-filter_threads",
      "1",
      "-filter_complex_threads",
      "1",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-metadata",
      "location=",
      "-metadata",
      "creation_time=",
      "-metadata",
      "title=",
      "-metadata",
      "comment=",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      "@OUTPUT",
    ],
    source,
    playback,
    signal,
    180,
  );
  const info = await probe(playback, signal, true);
  if (Math.abs(info.durationMs - input.durationMs) > 1000)
    throw new VideoError("incomplete_decode");
  const thumbnail = await runTool(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-xerror",
      "-protocol_whitelist",
      "file",
      "-format_whitelist",
      "mov",
      "-threads",
      "2",
      "-i",
      "@INPUT",
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "scale=480:480:force_original_aspect_ratio=decrease",
      "-filter_threads",
      "1",
      "-map_metadata",
      "-1",
      "-c:v",
      "libwebp",
      "-quality",
      "80",
      "-f",
      "image2pipe",
      "pipe:1",
    ],
    playback,
    null,
    signal,
    15,
    2 * 1024 * 1024,
  );
  await writeFile(poster, thumbnail, { flag: "wx", mode: 0o600 });
  const playbackBytes = (await stat(playback)).size,
    posterBytes = thumbnail.length;
  if (
    playbackBytes <= 0 ||
    playbackBytes > 90 * 1024 * 1024 ||
    posterBytes <= 0 ||
    posterBytes > 2 * 1024 * 1024
  )
    throw new VideoError("processed_size");
  return {
    ...info,
    sourceSha256: await fileHash(source),
    sha256: await fileHash(playback),
    playbackBytes,
    posterBytes,
    playback,
    poster,
    processorMode: processingMode(),
  };
}
