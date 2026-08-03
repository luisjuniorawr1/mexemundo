import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RealtimeClient,
  decodePose,
  encodePose,
  isNewerSequence
} from '../public/js/realtime.js';

const QUANTIZED_POSITION_TOLERANCE = 1 / 65535;
const QUANTIZED_VELOCITY_TOLERANCE = 1 / 8191;

function assertClose(actual, expected, tolerance) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `esperava ${expected}, recebeu ${actual}`
  );
}

function samplePose(sequence = 1) {
  return {
    detected: true,
    sequence,
    processingMs: 13,
    sourceIntervalMs: 17,
    left: { x: 0.1234, y: 0.8765, vx: -1.25, vy: 2.5, visible: true },
    right: { x: 0.82, y: 0.21, vx: 0.75, vy: -0.5, visible: false },
    leftShoulder: { x: 0.42, y: 0.35, vx: 0.02, vy: -0.03, visible: true },
    rightShoulder: { x: 0.58, y: 0.36, vx: -0.02, vy: 0.03, visible: false }
  };
}

test('codec v1 preserva layout binário de 40 bytes e campos quantizados', () => {
  const packet = encodePose(samplePose(0x10002));
  const view = new DataView(packet);

  assert.equal(packet.byteLength, 40);
  assert.equal(view.getUint8(0), 0x4d);
  assert.equal(view.getUint8(1), 1);
  assert.equal(view.getUint8(2), 0b00001011);
  assert.equal(view.getUint8(3), 0);
  assert.equal(view.getUint16(4, true), 2);
  assert.equal(view.getUint8(6), 13);
  assert.equal(view.getUint8(7), 17);

  const decoded = decodePose(packet);
  assert.equal(decoded.detected, true);
  assert.equal(decoded.sequence, 2);
  assert.equal(decoded.left.visible, true);
  assert.equal(decoded.right.visible, false);
  assert.equal(decoded.leftShoulder.visible, true);
  assert.equal(decoded.rightShoulder.visible, false);
  assertClose(decoded.left.x, 0.1234, QUANTIZED_POSITION_TOLERANCE);
  assertClose(decoded.left.y, 0.8765, QUANTIZED_POSITION_TOLERANCE);
  assertClose(decoded.left.vx, -1.25, QUANTIZED_VELOCITY_TOLERANCE);
  assertClose(decoded.left.vy, 2.5, QUANTIZED_VELOCITY_TOLERANCE);
});

test('decoder rejeita tamanho, magic e versão incompatíveis', () => {
  const packet = encodePose(samplePose());
  assert.equal(decodePose(new ArrayBuffer(39)), null);

  const badMagic = packet.slice(0);
  new DataView(badMagic).setUint8(0, 0);
  assert.equal(decodePose(badMagic), null);

  const badVersion = packet.slice(0);
  new DataView(badVersion).setUint8(1, 2);
  assert.equal(decodePose(badVersion), null);
});

test('ordena sequência uint16 incluindo wrap e rejeita antigas ou duplicadas', () => {
  assert.equal(isNewerSequence(10, null), true);
  assert.equal(isNewerSequence(11, 10), true);
  assert.equal(isNewerSequence(10, 10), false);
  assert.equal(isNewerSequence(9, 10), false);
  assert.equal(isNewerSequence(0, 65535), true);
  assert.equal(isNewerSequence(32767, 0), true);
  assert.equal(isNewerSequence(32768, 0), false);
});

test('quality separa gaps, fora de ordem, coalescidas e expiradas', () => {
  const client = new RealtimeClient();
  let quality;
  client.on('quality', (next) => { quality = next; });

  client.acceptPose({ sequence: 65534 });
  client.acceptPose({ sequence: 1 });
  client.acceptPose({ sequence: 1 });
  client.acceptPose({ sequence: 65535 });
  client.poseCoalesced = 3;
  client.poseExpired = 2;
  client.directRtt = 48;
  client.lastQualityDispatchAt = 0;
  client.dispatchQuality();

  assert.equal(quality.received, 2);
  assert.equal(quality.sequenceGaps, 2);
  assert.equal(quality.outOfOrderOrDuplicate, 2);
  assert.equal(quality.coalesced, 3);
  assert.equal(quality.expired, 2);
  assert.equal(quality.dropped, 9);
  assert.equal(quality.dropRate, 9 / 11);
  assert.equal(quality.rtt, undefined);
});

test('quality agenda atualização final quando o fluxo para dentro do throttle', async () => {
  const client = new RealtimeClient();
  const updates = [];
  client.on('quality', (quality) => updates.push(quality));
  client.lastQualityDispatchAt = performance.now() - 735;

  client.countExpiredPose();
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(updates.at(-1).expired, 1);
  assert.equal(client.qualityDispatchTimer, null);
});

test('nova origem reinicia ordenação, mas troca de transporte preserva sequência', () => {
  const client = new RealtimeClient();
  const received = [];
  let resets = 0;
  client.on('pose', (value) => received.push(value.sequence));
  client.on('pose-stream-reset', () => { resets += 1; });

  client.acceptPose({ sequence: 1000 });
  client.acceptPose({ sequence: 1 });
  assert.deepEqual(received, [1000]);

  client.handleIncoming({
    type: 'pose-stream-reset',
    payload: { reason: 'phone-joined' }
  });
  client.acceptPose({ sequence: 1 });
  assert.deepEqual(received, [1000, 1]);
  assert.equal(resets, 1);

  client.closePeer(false);
  assert.equal(client.lastPoseSequence, 1);
});

test('pose em fallback usa mailbox WebSocket e nunca o DataChannel confiável', () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = { OPEN: 1 };

  try {
    const socketMessages = [];
    const reliableMessages = [];
    const client = new RealtimeClient();
    client.socket = {
      readyState: 1,
      bufferedAmount: 40,
      send: (message) => socketMessages.push(message)
    };
    client.reliableChannel = {
      readyState: 'open',
      send: (message) => reliableMessages.push(message)
    };

    assert.equal(client.emit('pose', samplePose(20)), true);
    assert.equal(client.emit('pose', samplePose(21)), true);
    assert.equal(client.poseCoalesced, 1);
    assert.equal(reliableMessages.length, 0);
    assert.equal(socketMessages.length, 0);

    clearTimeout(client.relayPoseFlushTimer);
    client.relayPoseFlushTimer = null;
    client.socket.bufferedAmount = 0;
    client.flushRelayPose();

    assert.equal(socketMessages.length, 1);
    assert.equal(JSON.parse(socketMessages[0]).payload.sequence, 21);
    assert.equal(client.pendingRelayPose, null);

    client.socket.bufferedAmount = 40;
    assert.equal(client.emit('pose', samplePose(22)), true);
    clearTimeout(client.relayPoseFlushTimer);
    client.relayPoseFlushTimer = null;
    client.pendingRelayPoseAt = performance.now() - 1000;
    client.socket.bufferedAmount = 0;
    client.flushRelayPose();

    assert.equal(socketMessages.length, 1);
    assert.equal(client.pendingRelayPose, null);
    assert.equal(client.poseExpired, 1);
  } finally {
    if (previousWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = previousWebSocket;
  }
});

test('canal direto substitui somente a pose binária pendente', () => {
  const reliableMessages = [];
  const directMessages = [];
  const client = new RealtimeClient();
  client.transportMode = 'direct';
  client.poseChannel = {
    readyState: 'open',
    bufferedAmount: 40,
    send: (message) => directMessages.push(message)
  };
  client.reliableChannel = {
    readyState: 'open',
    send: (message) => reliableMessages.push(message)
  };

  assert.equal(client.emit('pose', samplePose(30)), true);
  assert.equal(client.emit('pose', samplePose(31)), true);

  assert.equal(client.poseCoalesced, 1);
  assert.equal(decodePose(client.pendingPosePacket).sequence, 31);
  assert.equal(reliableMessages.length, 0);

  client.poseChannel.bufferedAmount = 0;
  assert.equal(client.emit('pose', samplePose(32)), true);
  assert.equal(client.poseCoalesced, 2);
  assert.equal(directMessages.length, 0);
  assert.equal(decodePose(client.pendingPosePacket).sequence, 32);

  client.flushDirectPose();
  assert.equal(decodePose(directMessages[0]).sequence, 32);
  assert.equal(client.pendingPosePacket, null);

  client.poseChannel.bufferedAmount = 40;
  assert.equal(client.emit('pose', samplePose(33)), true);
  client.pendingPosePacketAt = performance.now() - 1000;
  client.poseChannel.bufferedAmount = 0;
  client.flushDirectPose();

  assert.equal(client.pendingPosePacket, null);
  assert.equal(client.poseExpired, 1);
});

test('eventos de um DataChannel substituído não entregam pose antiga', () => {
  const createChannel = () => {
    const handlers = new Map();
    return {
      label: 'mexemundo-pose',
      readyState: 'open',
      bufferedAmount: 0,
      addEventListener: (type, callback) => handlers.set(type, callback),
      emit: (type, event = {}) => handlers.get(type)?.(event)
    };
  };
  const client = new RealtimeClient();
  const received = [];
  client.on('pose', (value) => received.push(value.sequence));
  const oldChannel = createChannel();
  const currentChannel = createChannel();

  client.attachPoseChannel(oldChannel);
  client.attachPoseChannel(currentChannel);
  oldChannel.emit('message', { data: encodePose(samplePose(90)) });
  currentChannel.emit('message', { data: encodePose(samplePose(1)) });

  assert.deepEqual(received, [1]);
});

test('negociação obsoleta não libera o lock de um peer mais novo', async () => {
  const previousPeerConnection = globalThis.RTCPeerConnection;
  const previousWebSocket = globalThis.WebSocket;
  const instances = [];

  class FakePeerConnection {
    constructor() {
      this.listeners = new Map();
      this.localDescription = null;
      this.offerPromise = new Promise((resolve) => { this.resolveOffer = resolve; });
      instances.push(this);
    }

    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    }

    createDataChannel(label) {
      return {
        label,
        readyState: 'connecting',
        bufferedAmount: 0,
        addEventListener() {},
        close() {}
      };
    }

    createOffer() {
      return this.offerPromise;
    }

    async setLocalDescription(description) {
      this.localDescription = description;
    }

    close() {}
  }

  globalThis.RTCPeerConnection = FakePeerConnection;
  globalThis.WebSocket = { OPEN: 1 };
  try {
    const client = new RealtimeClient();
    client.role = 'tv';
    client.roomStatus = { tv: true, phone: true };

    const firstStart = client.startDirectConnection();
    assert.equal(client.peerStarting, true);
    const firstPeer = instances[0];

    client.handleIncoming({ type: 'pose-stream-reset', payload: { reason: 'phone-joined' } });
    const secondStart = client.startDirectConnection();
    const secondPeer = instances[1];
    assert.equal(client.peerStarting, true);

    firstPeer.resolveOffer({ type: 'offer', sdp: 'old' });
    await firstStart;
    assert.equal(client.peer, secondPeer);
    assert.equal(client.peerStarting, true);

    secondPeer.resolveOffer({ type: 'offer', sdp: 'new' });
    await secondStart;
    assert.equal(client.peer, secondPeer);
    assert.equal(client.peerStarting, false);
  } finally {
    if (previousPeerConnection === undefined) delete globalThis.RTCPeerConnection;
    else globalThis.RTCPeerConnection = previousPeerConnection;
    if (previousWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = previousWebSocket;
  }
});

test('falha do ping direto não mistura fallback WebSocket no mesmo RTT', async () => {
  const client = new RealtimeClient();
  const socketMessages = [];
  client.poseChannel = { readyState: 'open' };
  client.socket = { send: (message) => socketMessages.push(message) };
  client.directRequest = async () => {
    throw new Error('ping direto perdido');
  };

  await assert.rejects(
    client.request('ping-latency', { sentAt: 123 }, 1800),
    /ping direto perdido/
  );
  assert.equal(socketMessages.length, 0);
});
