export interface LabelBox { x: number; y: number; width: number; height: number }

const overlaps = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.width + 3 && a.x + a.width + 3 > b.x &&
  a.y < b.y + b.height + 3 && a.y + a.height + 3 > b.y;

/** Presentation only. A crowded view retains its original labels rather than
 * changing target eligibility, capture state, distance or damage information. */
export class OverlayLabels {
  private readonly occupied: LabelBox[];
  private comparisonsLeft = 12000;
  constructor(private readonly width: number, private readonly height: number, boxes: readonly LabelBox[]) {
    this.occupied = boxes.map(box => ({ ...box }));
  }
  reserve(box: LabelBox): void { this.occupied.push({ ...box }); }
  place(preferred: LabelBox): LabelBox {
    const margin = 6, gap = 4;
    const clamp = (box: LabelBox) => ({ ...box,
      x: Math.max(margin, Math.min(this.width - margin - box.width, box.x)),
      y: Math.max(margin, Math.min(this.height - margin - box.height, box.y)),
    });
    const fits = (box: LabelBox) => {
      if (box.x < margin || box.y < margin || box.x + box.width > this.width - margin || box.y + box.height > this.height - margin) return false;
      for (const obstacle of this.occupied) {
        if (this.comparisonsLeft-- <= 0 || overlaps(box, obstacle)) return false;
      }
      return true;
    };
    const origin = clamp(preferred);
    let chosen: LabelBox | undefined = fits(origin) ? origin : undefined;
    if (!chosen && this.comparisonsLeft > 0) {
      const candidates: LabelBox[] = [];
      for (const obstacle of this.occupied) {
        const xs = [obstacle.x - preferred.width - gap, obstacle.x + obstacle.width + gap];
        const ys = [obstacle.y - preferred.height - gap, obstacle.y + obstacle.height + gap];
        for (const x of xs) candidates.push(clamp({ ...preferred, x, y: origin.y }));
        for (const y of ys) candidates.push(clamp({ ...preferred, x: origin.x, y }));
        for (const x of xs) for (const y of ys) candidates.push(clamp({ ...preferred, x, y }));
      }
      candidates.sort((a, b) =>
        (a.x - origin.x) ** 2 + (a.y - origin.y) ** 2 -
        ((b.x - origin.x) ** 2 + (b.y - origin.y) ** 2) || a.y - b.y || a.x - b.x);
      chosen = candidates.find(fits);
    }
    if (!chosen && this.comparisonsLeft > 0) {
      // A bounded final scan also handles intersecting reservations whose edge
      // candidates are blocked by a third box. It never removes label content.
      let best = Infinity;
      for (let y = margin; this.comparisonsLeft > 0 && y + preferred.height <= this.height - margin; y += Math.max(18, preferred.height + gap)) {
        for (let x = margin; this.comparisonsLeft > 0 && x + preferred.width <= this.width - margin; x += Math.max(32, preferred.width + gap)) {
          const box = { ...preferred, x, y }, distance = (x - origin.x) ** 2 + (y - origin.y) ** 2;
          if (distance < best && fits(box)) { chosen = box; best = distance; }
        }
      }
    }
    const result = chosen ?? preferred;
    this.reserve(result);
    return { ...result };
  }
}

const hudCache = new WeakMap<HTMLCanvasElement, { signature: string; boxes: LabelBox[] }>();
export function compactOverlayLabels(canvas: HTMLCanvasElement, width: number, height: number): OverlayLabels | null {
  if (width <= height || height > 360) return null;
  const document = canvas.ownerDocument, hud = document.querySelector<HTMLElement>('#hud');
  const app = hud?.closest<HTMLElement>('#app');
  const signature = [width, height, hud?.textContent?.replace(/\d/g, '0'),
    app?.className, app?.dataset.mode, app?.dataset.hudReservationPhase,
    app?.style.cssText, hud?.style.cssText, document.documentElement.style.cssText, document.fonts?.status,
    ...Array.from(hud?.querySelectorAll<HTMLElement>('[style]') ?? [], element => element.style.cssText)].join('|');
  let cached = hudCache.get(canvas);
  if (!cached || cached.signature !== signature) {
    const canvasBox = canvas.getBoundingClientRect(), boxes: LabelBox[] = [];
    const sx = width / Math.max(1, canvasBox.width), sy = height / Math.max(1, canvasBox.height);
    const add = (rect: DOMRect) => {
      if (rect.width > 0 && rect.height > 0) boxes.push({ x: (rect.left - canvasBox.left) * sx,
        y: (rect.top - canvasBox.top) * sy, width: rect.width * sx, height: rect.height * sy });
    };
    if (hud) {
      const visible = (element: HTMLElement) => {
        const style = document.defaultView?.getComputedStyle(element);
        return !element.closest('[hidden]') && element.getClientRects().length > 0 && style?.visibility !== 'hidden' && style?.visibility !== 'collapse';
      };
      for (const element of hud.querySelectorAll<HTMLElement>('button,[data-flight-control]')) {
        if (visible(element)) add(element.getBoundingClientRect());
      }
      const walker = document.createTreeWalker(hud, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!node.textContent?.trim() || !parent || parent.closest('button,[data-flight-control],.visually-hidden,[aria-hidden="true"],[hidden]') ||
          !visible(parent)) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) add(rect);
      }
    }
    cached = { signature, boxes }; hudCache.set(canvas, cached);
  }
  const radius = width < 360 ? 42 : 49;
  return new OverlayLabels(width, height, [...cached.boxes,
    { x: width - 2 * radius - 18, y: Math.min(height * .33, 180) - radius,
      width: 2 * radius, height: 2 * radius + 16 }]);
}

export function overlayTextPosition(layout: OverlayLabels | null, c: CanvasRenderingContext2D,
  text: string, x: number, y: number, extraTop = 0, minWidth = 0): { x: number; y: number } {
  if (!layout) return { x, y };
  const metrics = c.measureText(text), ascent = Math.max(10, metrics.actualBoundingBoxAscent), descent = Math.max(3, metrics.actualBoundingBoxDescent);
  const width = Math.max(minWidth, Math.ceil(metrics.width)) + 4;
  const original = { x: x - width / 2, y: y - ascent - extraTop - 2, width, height: ascent + descent + extraTop + 4 };
  const box = layout.place(original);
  return { x: box.x + width / 2, y: box.y + ascent + extraTop + 2 };
}

export function overlayLabelLeader(c: CanvasRenderingContext2D, anchor: { x: number; y: number }, label: { x: number; y: number }): void {
  if (Math.hypot(label.x - anchor.x, label.y - anchor.y) < 20) return;
  c.save(); c.globalAlpha = .4; c.lineWidth = .75; c.strokeStyle = c.fillStyle;
  c.beginPath(); c.moveTo(anchor.x, anchor.y); c.lineTo(label.x, label.y - 6); c.stroke(); c.restore();
}
