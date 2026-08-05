function visibleHands(frame) {
  return [frame?.left, frame?.right].filter((hand) => hand?.visible);
}

function separation(left, right) {
  return Math.hypot(
    Number(left?.x ?? 0) - Number(right?.x ?? 0),
    Number(left?.y ?? 0) - Number(right?.y ?? 0)
  );
}

/**
 * Verificação inicial isolada do rastreamento.
 *
 * Ela apenas confirma que os dois rastros já existem, estão separados e
 * estáveis antes de abrir o menu. Não altera posições, filtros ou identidade.
 */
export function evaluateTwoHandStartup(frame, config) {
  const hands = visibleHands(frame);

  if (!frame?.fresh || !frame?.detected) {
    return { ready: false, reason: 'missing-frame', hands, speed: Infinity };
  }

  if (hands.length < Number(config.minimumVisibleHands || 2)) {
    return { ready: false, reason: 'missing-hands', hands, speed: Infinity };
  }

  if (
    config.requireShoulders
    && (!frame.leftShoulder?.visible || !frame.rightShoulder?.visible)
  ) {
    return { ready: false, reason: 'missing-shoulders', hands, speed: Infinity };
  }

  const handSeparation = separation(frame.left, frame.right);
  if (handSeparation < Number(config.minimumHandSeparation || 0)) {
    return {
      ready: false,
      reason: 'hands-too-close',
      hands,
      separation: handSeparation,
      speed: Infinity
    };
  }

  const speed = Math.max(
    ...hands.map((hand) => Math.hypot(hand.vx ?? 0, hand.vy ?? 0))
  );
  if (speed > Number(config.maximumStillSpeed || Infinity)) {
    return {
      ready: false,
      reason: 'moving',
      hands,
      separation: handSeparation,
      speed
    };
  }

  return {
    ready: true,
    reason: 'ready',
    hands,
    separation: handSeparation,
    speed
  };
}
