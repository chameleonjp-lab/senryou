export interface ControlOpacityObservation {
  customProperty: string;
  computedOpacity: string;
}

function opacityValue(raw: string, source: string): number {
  // Number('') is zero; only an actual finite CSS number is an observation.
  const text = raw.trim();
  const value = Number(text);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)
    || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid ${source} opacity: ${JSON.stringify(raw)}`);
  }
  return value;
}

export function appliedControlOpacity(observation: ControlOpacityObservation): number {
  const custom = opacityValue(observation.customProperty, '--control-opacity');
  const computed = opacityValue(observation.computedOpacity, 'computed');
  if (computed !== custom) {
    throw new Error(`Control opacity not applied: --control-opacity=${custom}, computed=${computed}`);
  }
  return computed;
}
