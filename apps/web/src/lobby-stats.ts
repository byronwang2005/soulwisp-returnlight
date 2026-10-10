export interface LobbyTrackMetrics {
  trackId: string; peerId: string; roundTripMs: number | null; lossPercent: number | null;
  jitterMs: number | null; bufferMs: number | null; protocol: string | null; relay: boolean | null; relayProtocol: string | null;
}
interface Counters { received: number; lost: number; delay: number; emitted: number; at: number }
export class LobbyStats {
  private previous = new Map<string, Counters>();
  clear() { this.previous.clear(); }
  retain(ids: Set<string>) { for (const id of this.previous.keys()) if (!ids.has(id)) this.previous.delete(id); }
  sample(trackId: string, peerId: string, report: RTCStatsReport): LobbyTrackMetrics {
    const result: LobbyTrackMetrics = { trackId, peerId, roundTripMs: null, lossPercent: null, jitterMs: null, bufferMs: null, protocol: null, relay: null, relayProtocol: null };
    const values = [...report.values()];
    const transport = values.find(value => value.type === 'transport' && value.selectedCandidatePairId);
    const pair = transport ? report.get(transport.selectedCandidatePairId) : values.find(value => value.type === 'candidate-pair' && value.nominated && value.state === 'succeeded');
    if (pair) {
      result.roundTripMs = finite(pair.currentRoundTripTime, 1000);
      const local = report.get(pair.localCandidateId), remote = report.get(pair.remoteCandidateId);
      result.protocol = local?.protocol ?? remote?.protocol ?? null;
      result.relay = local || remote ? local?.candidateType === 'relay' || remote?.candidateType === 'relay' : null;
      result.relayProtocol = local?.relayProtocol ?? null;
    }
    const stat = values.find(value => value.type === 'inbound-rtp' && (value.kind === 'audio' || value.mediaType === 'audio'));
    if (!stat) return result;
    result.jitterMs = finite(stat.jitter, 1000);
    const current: Counters = { received: stat.packetsReceived ?? 0, lost: stat.packetsLost ?? 0,
      delay: stat.jitterBufferDelay ?? 0, emitted: stat.jitterBufferEmittedCount ?? 0, at: stat.timestamp };
    const before = this.previous.get(trackId);
    this.previous.set(trackId, current);
    if (before && current.at > before.at && current.received >= before.received && current.delay >= before.delay && current.emitted >= before.emitted) {
      const received = current.received - before.received, lost = Math.max(0, current.lost - before.lost);
      if (received + lost > 0) result.lossPercent = lost * 100 / (received + lost);
      const emitted = current.emitted - before.emitted;
      if (emitted > 0) result.bufferMs = (current.delay - before.delay) * 1000 / emitted;
    }
    return result;
  }
}
function finite(value: unknown, multiplier = 1): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value * multiplier : null; }
export function lobbyNetworkQuality(tracks: LobbyTrackMetrics[]): 'unknown' | 'good' | 'fair' | 'poor' {
  if (!tracks.some(track => track.roundTripMs !== null || track.jitterMs !== null)) return 'unknown';
  if (tracks.some(track => (track.roundTripMs ?? 0) > 300 || (track.lossPercent ?? 0) > 5 || (track.jitterMs ?? 0) > 50)) return 'poor';
  if (tracks.some(track => (track.roundTripMs ?? 0) > 150 || (track.lossPercent ?? 0) > 2 || (track.jitterMs ?? 0) > 25)) return 'fair';
  return 'good';
}
