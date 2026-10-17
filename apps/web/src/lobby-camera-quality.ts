import type { RemoteVideoTrack } from 'livekit-client';

export type CameraBufferStatus = 'realtime' | 'pending' | 'smooth' | 'unsupported';

/** Only the camera receiver is changed; voice receivers keep their defaults. */
export function cameraBuffer(track: RemoteVideoTrack, smooth: boolean): { status: CameraBufferStatus; restore: () => void } {
  const receiver = track.receiver as (RTCRtpReceiver & { jitterBufferTarget?: number | null; playoutDelayHint?: number }) | undefined;
  if (!receiver) return { status: smooth ? 'unsupported' : 'realtime', restore: () => {} };
  for (const key of ['jitterBufferTarget', 'playoutDelayHint'] as const) {
    if (!(key in receiver)) continue;
    const previous = receiver[key];
    try {
      if (key === 'jitterBufferTarget') receiver.jitterBufferTarget = smooth ? 300 : 0;
      else track.setPlayoutDelay(smooth ? .3 : 0);
      return { status: smooth ? 'smooth' : 'realtime', restore: () => {
        try { Reflect.set(receiver, key, previous); } catch { /* Receiver may have ended. */ }
      } };
    } catch { /* Try the SDK fallback if the standard setter is unavailable. */ }
  }
  return { status: smooth ? 'unsupported' : 'realtime', restore: () => {} };
}

export interface CameraMetrics {
  direction: 'send' | 'receive';
  captureWidth: number | null; captureHeight: number | null; captureFps: number | null;
  width: number | null; height: number | null; fps: number | null; bitrate: number | null;
  limitation: string | null; lossPercent: number | null; bufferMs: number | null;
}
type Stat = Record<string, unknown>;
const number = (stat: Stat, key: string): number | null => typeof stat[key] === 'number' && Number.isFinite(stat[key]) ? stat[key] as number : null;

export class CameraStats {
  private previous: Stat | null = null;
  clear() { this.previous = null; }
  sample(report: RTCStatsReport, direction: 'send' | 'receive', capture?: MediaTrackSettings): CameraMetrics {
    const candidates: Stat[] = [];
    const bytesKey = direction === 'send' ? 'bytesSent' : 'bytesReceived';
    report.forEach(stat => {
      if (stat.type !== (direction === 'send' ? 'outbound-rtp' : 'inbound-rtp') || (stat.kind ?? stat.mediaType) !== 'video' || stat.isRemote) return;
      const codec = report.get(stat.codecId);
      if (/\/(rtx|red|ulpfec|flexfec)/i.test(codec?.mimeType ?? '')) return;
      candidates.push(stat);
    });
    const current = candidates.sort((a, b) => (number(b, bytesKey) ?? 0) - (number(a, bytesKey) ?? 0))[0] ?? {};
    const previous = this.previous;
    const elapsed = previous && current.id === previous.id ? ((number(current, 'timestamp') ?? 0) - (number(previous, 'timestamp') ?? 0)) / 1000 : 0;
    const delta = (key: string): number | null => {
      const now = number(current, key), before = previous && number(previous, key);
      return elapsed > 0 && now !== null && before != null && now >= before ? now - before : null;
    };
    const bytes = delta(bytesKey), frames = delta(direction === 'send' ? 'framesEncoded' : 'framesDecoded');
    const lost = delta('packetsLost'), received = delta('packetsReceived');
    const buffer = delta('jitterBufferDelay'), emitted = delta('jitterBufferEmittedCount');
    this.previous = current;
    return {
      direction, captureWidth: capture?.width ?? null, captureHeight: capture?.height ?? null, captureFps: capture?.frameRate ?? null,
      width: number(current, 'frameWidth'), height: number(current, 'frameHeight'),
      fps: number(current, 'framesPerSecond') ?? (frames !== null ? frames / elapsed : null),
      bitrate: bytes !== null ? bytes * 8 / elapsed : null,
      limitation: typeof current.qualityLimitationReason === 'string' ? current.qualityLimitationReason : null,
      lossPercent: lost !== null && received !== null && lost + received > 0 ? lost * 100 / (lost + received) : null,
      bufferMs: buffer !== null && emitted !== null && emitted > 0 ? buffer * 1000 / emitted : null,
    };
  }
}
