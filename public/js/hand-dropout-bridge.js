function copyPoint(point) {
  return {
    x: Number.isFinite(point?.x) ? Number(point.x) : 0.5,
    y: Number.isFinite(point?.y) ? Number(point.y) : 0.5,
    vx: Number.isFinite(point?.vx) ? Number(point.vx) : 0,
    vy: Number.isFinite(point?.vy) ? Number(point.vy) : 0,
    visible: Boolean(point?.visible)
  };
}

/**
 * Mantém a última posição válida durante perdas muito curtas do detector.
 * Não prevê movimento e não prolonga desaparecimentos reais.
 */
export class HandDropoutBridge {
  constructor() {
    this.reset();
  }

  reset() {
    this.lastPoint = null;
    this.lastVisibleAt = 0;
  }

  ingest(point, receivedAt) {
    if (!point?.visible) return;
    this.lastPoint = copyPoint(point);
    this.lastVisibleAt = Number(receivedAt) || 0;
  }

  sample(point, now, graceMs) {
    if (point?.visible) return copyPoint(point);

    const canBridge = this.lastPoint
      && this.lastVisibleAt
      && Number(now) - this.lastVisibleAt <= Number(graceMs || 0);
    if (!canBridge) return copyPoint(point);

    return {
      ...this.lastPoint,
      vx: 0,
      vy: 0,
      visible: true,
      bridged: true
    };
  }
}
