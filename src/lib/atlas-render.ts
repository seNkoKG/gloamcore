export interface AtlasArcGeometry {
  startAngle: number;
  endAngle: number;
  anticlockwise: boolean;
}

export function atlasConnectorArc(
  center: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): AtlasArcGeometry {
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const targetAngle = Math.atan2(to.y - center.y, to.x - center.x);
  let sweep = targetAngle - startAngle;
  if (sweep > Math.PI) sweep -= Math.PI * 2;
  if (sweep < -Math.PI) sweep += Math.PI * 2;
  return {
    startAngle,
    endAngle: startAngle + sweep,
    anticlockwise: sweep < 0,
  };
}
