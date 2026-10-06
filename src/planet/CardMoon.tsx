/**
 * The mark of a planet with a card space inside: a small deck of cards circling
 * it like a moon (passing behind the planet on the far side of its orbit), and
 * next to the name a card badge with the number of cards. Long-press the
 * planet to dive in, as before.
 */
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Layers } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { CanvasTexture, Color, Group, SRGBColorSpace, type Sprite } from 'three';
import { currentAppLocale } from '../i18n/locales';
import { cardBadgeLabel, useCardPresence } from './cardPresence';

let cardTexture: CanvasTexture | null = null;
/** A plain card drawn once: rounded white face, a title bar and two text lines. */
function getCardTexture() {
  if (cardTexture) return cardTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  };
  round(6, 6, 84, 116, 12);
  context.fillStyle = 'rgba(255, 255, 255, 0.94)';
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(255, 255, 255, 1)';
  context.stroke();
  context.fillStyle = 'rgba(40, 52, 72, 0.55)';
  round(18, 22, 60, 10, 5);
  context.fill();
  context.fillStyle = 'rgba(40, 52, 72, 0.28)';
  round(18, 46, 52, 7, 3.5);
  context.fill();
  round(18, 62, 44, 7, 3.5);
  context.fill();
  cardTexture = new CanvasTexture(canvas);
  cardTexture.colorSpace = SRGBColorSpace;
  return cardTexture;
}

function seededAngle(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return ((hash >>> 0) / 4294967296) * Math.PI * 2;
}

export function CardMoon({
  planetId,
  radius,
  color,
  opacity,
  animate,
  showBadge,
}: {
  planetId: string;
  radius: number;
  color: string;
  opacity: number;
  animate: boolean;
  showBadge: boolean;
}) {
  const known = useCardPresence((state) => state.refreshedAt > 0);
  const count = useCardPresence((state) => state.cards[planetId]);
  const group = useRef<Group>(null);
  const phase = useMemo(() => seededAngle(planetId), [planetId]);
  const tint = useMemo(() => new Color(color).lerp(new Color('#ffffff'), 0.62), [color]);
  const texture = useMemo(() => getCardTexture(), []);
  const deck = Math.max(1, Math.min(3, count ?? 1));
  const orbit = radius * 1.55;
  const cardWidth = Math.max(5, radius * 0.5);
  const empty = !count;

  useFrame(({ clock }) => {
    const moon = group.current;
    if (!moon) return;
    const angle = phase + (animate ? clock.elapsedTime * 0.45 : 0);
    // A tilted orbit: in front of the planet on one side, hidden behind it on the other.
    moon.position.set(Math.cos(angle) * orbit, Math.sin(angle) * orbit * 0.3, Math.sin(angle) * orbit * 0.85);
    moon.children.forEach((child, index) => {
      (child as Sprite).material.opacity = opacity * (empty ? 0.5 : 0.92 - index * 0.12);
    });
  });

  if (!known) return null;
  return (
    <>
      <group ref={group}>
        {Array.from({ length: deck }, (_, index) => (
          <sprite
            key={index}
            position={[index * cardWidth * 0.22, -index * cardWidth * 0.12, -index * 0.5]}
            scale={[cardWidth, cardWidth * 1.33, 1]}
            raycast={() => undefined}
          >
            <spriteMaterial map={texture} color={tint} transparent depthWrite={false} opacity={opacity} />
          </sprite>
        ))}
      </group>
      {showBadge ? (
        <Html center position={[radius * 0.86, radius * 0.92, 16]} transform={false} zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
          <span className={`node-card-badge${empty ? ' is-empty' : ''}`} role="img" aria-label={cardBadgeLabel(count, currentAppLocale())} title={cardBadgeLabel(count, currentAppLocale())}>
            <Layers size={11} aria-hidden="true" />
            {count ? <b>{count}</b> : null}
          </span>
        </Html>
      ) : null}
    </>
  );
}
