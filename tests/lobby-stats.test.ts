import { describe, expect, it } from 'vitest';
import { LobbyStats, lobbyNetworkQuality } from '../apps/web/src/lobby-stats';

function report(received: number, lost: number, delay: number, emitted: number, timestamp: number): RTCStatsReport {
  return new Map([
    ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { id: 'pair', type: 'candidate-pair', currentRoundTripTime: .04, localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { id: 'local', type: 'local-candidate', protocol: 'udp', candidateType: 'host' }],
    ['remote', { id: 'remote', type: 'remote-candidate', protocol: 'udp', candidateType: 'relay' }],
    ['audio', { id: 'audio', type: 'inbound-rtp', kind: 'audio', packetsReceived: received, packetsLost: lost, jitterBufferDelay: delay, jitterBufferEmittedCount: emitted, timestamp, jitter: .008 }],
  ]) as unknown as RTCStatsReport;
}
describe('voice lobby interval diagnostics', () => {
  it('uses interval counters instead of lifetime averages and reports the selected ICE path', () => {
    const stats = new LobbyStats();
    expect(stats.sample('a', 'peer-a', report(1000, 100, 100, 1000, 1))).toMatchObject({ lossPercent: null, bufferMs: null, roundTripMs: 40, protocol: 'udp', relay: true });
    const sample = stats.sample('a', 'peer-a', report(1099, 101, 101, 1100, 2));
    expect(sample.lossPercent).toBe(1); expect(sample.bufferMs).toBe(10); expect(sample.jitterMs).toBe(8);
    expect(lobbyNetworkQuality([sample])).toBe('good');
    expect(lobbyNetworkQuality([{ ...sample, lossPercent: 6 }])).toBe('poor');
    const tls = report(1200, 101, 102, 1200, 3);
    Object.assign(tls.get('local')!, { candidateType: 'relay', relayProtocol: 'tls' });
    expect(stats.sample('a', 'peer-a', tls)).toMatchObject({ protocol: 'udp', relay: true, relayProtocol: 'tls' });
  });
  it('isolates tracks, discards baselines after counter resets, and handles missing stats', () => {
    const stats = new LobbyStats();
    stats.sample('a', 'peer-a', report(100, 5, 5, 50, 1));
    expect(stats.sample('b', 'peer-b', report(110, 6, 6, 60, 2)).lossPercent).toBeNull();
    expect(stats.sample('a', 'peer-a', report(1, 0, .1, 1, 3)).bufferMs).toBeNull();
    stats.retain(new Set());
    expect(stats.sample('a', 'peer-a', report(10, 1, 1, 10, 4)).lossPercent).toBeNull();
    expect(stats.sample('empty', 'peer', new Map() as unknown as RTCStatsReport).roundTripMs).toBeNull();
    expect(lobbyNetworkQuality([])).toBe('unknown');
  });
});
