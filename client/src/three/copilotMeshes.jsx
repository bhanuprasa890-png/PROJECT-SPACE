import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Float, MeshDistortMaterial } from '@react-three/drei';

/**
 * One procedural mesh per copilot, keyed by `copilot.mesh` from the API.
 * Each has its own animation signature so the cards feel like five characters
 * rather than five recoloured spheres.
 */

function Rig({ speed = 0.42, float = 1.15, children }) {
  const group = useRef();
  useFrame((state, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * speed;
    // lean toward the pointer for a "it is looking at you" feel
    const targetX = state.pointer.y * -0.28;
    const targetY = state.pointer.x * 0.4;
    group.current.rotation.x += (targetX - group.current.rotation.x) * Math.min(1, delta * 3);
    group.current.rotation.z += (state.pointer.x * 0.12 - group.current.rotation.z) * Math.min(1, delta * 2.2);
  });
  return (
    <Float speed={float} rotationIntensity={0.35} floatIntensity={0.8}>
      <group ref={group}>{children}</group>
    </Float>
  );
}

/** Sigma — faceted blade: hard-edged crystals inside gyro rings (prep precision). */
export function SigmaMesh({ accent }) {
  const shards = useRef();
  const ringA = useRef();
  const ringB = useRef();
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (shards.current) shards.current.rotation.y -= delta * 0.9;
    if (ringA.current) ringA.current.rotation.z = t * 0.9;
    if (ringB.current) ringB.current.rotation.x = -t * 0.6;
  });
  const pieces = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => ({
        pos: [Math.cos((i / 6) * Math.PI * 2) * 0.62, Math.sin((i / 3) * Math.PI) * 0.34, Math.sin((i / 6) * Math.PI * 2) * 0.62],
        size: 0.15 + (i % 3) * 0.05,
        rot: i * 0.7,
      })),
    []
  );
  return (
    <Rig>
      <mesh>
        <octahedronGeometry args={[0.62, 0]} />
        <meshStandardMaterial color="#F6F1EA" metalness={0.95} roughness={0.08} envMapIntensity={1.4} flatShading />
      </mesh>
      <mesh scale={1.9}>
        <icosahedronGeometry args={[0.62, 0]} />
        <meshBasicMaterial color={accent} wireframe transparent opacity={0.22} />
      </mesh>
      <group ref={shards}>
        {pieces.map((p, i) => (
          <mesh key={i} position={p.pos} rotation={[p.rot, p.rot * 0.6, 0]}>
            <tetrahedronGeometry args={[p.size, 0]} />
            <meshStandardMaterial color={accent} metalness={0.6} roughness={0.2} emissive={accent} emissiveIntensity={0.32} flatShading />
          </mesh>
        ))}
      </group>
      <mesh ref={ringA} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[1.15, 0.017, 8, 96]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
      <mesh ref={ringB} rotation={[0, Math.PI / 3, 0]}>
        <torusGeometry args={[1.34, 0.012, 8, 96]} />
        <meshStandardMaterial color="#FFF8F1" emissive="#FFF8F1" emissiveIntensity={0.7} toneMapped={false} />
      </mesh>
    </Rig>
  );
}

/** Manus — kneading torus knot: soft, always folding (hands-on technique). */
export function ManusMesh({ accent }) {
  const knot = useRef();
  const palms = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (knot.current) {
      knot.current.scale.setScalar(1 + Math.sin(t * 1.5) * 0.05);
      knot.current.rotation.x = t * 0.24;
    }
    if (palms.current) {
      palms.current.children.forEach((child, i) => {
        const a = t * 1.05 + i * Math.PI;
        child.position.set(Math.cos(a) * 0.98, Math.sin(a * 2) * 0.24, Math.sin(a) * 0.98);
        child.scale.setScalar(0.9 + Math.sin(a * 2) * 0.14);
      });
    }
  });
  return (
    <Rig speed={0.28} float={1.4}>
      <mesh ref={knot}>
        <torusKnotGeometry args={[0.52, 0.16, 160, 24, 2, 3]} />
        <MeshDistortMaterial color="#FFF3E2" roughness={0.55} metalness={0.12} distort={0.28} speed={1.7} />
      </mesh>
      <group ref={palms}>
        {[0, 1].map((i) => (
          <mesh key={i} scale={[1, 0.55, 1.15]}>
            <sphereGeometry args={[0.22, 28, 28]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.4} roughness={0.4} metalness={0.15} />
          </mesh>
        ))}
      </group>
      <mesh rotation-x={Math.PI / 2} position={[0, -0.72, 0]}>
        <torusGeometry args={[1.06, 0.02, 8, 72]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.1} toneMapped={false} />
      </mesh>
    </Rig>
  );
}

/** Nova — plasma core with flame licks and a flickering light (heat control). */
export function NovaMesh({ accent }) {
  const core = useRef();
  const flames = useRef();
  const light = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (core.current) core.current.rotation.y = t * 0.5;
    if (flames.current) {
      flames.current.children.forEach((child, i) => {
        const pulse = 0.72 + Math.sin(t * 6 + i * 1.3) * 0.28;
        child.scale.set(pulse, pulse * (1 + Math.sin(t * 9 + i) * 0.24), pulse);
      });
    }
    if (light.current) light.current.intensity = 7 + Math.sin(t * 13) * 2.6;
  });
  return (
    <Rig speed={0.5} float={0.9}>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.58, 4]} />
        <MeshDistortMaterial color={accent} emissive={accent} emissiveIntensity={1.5} toneMapped={false} roughness={0.24} distort={0.42} speed={3.1} />
      </mesh>
      <group ref={flames}>
        {Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.5, 0.55, Math.sin(a) * 0.5]} rotation={[0, -a, 0]}>
              <coneGeometry args={[0.11, 0.52, 8, 1, true]} />
              <meshBasicMaterial color={i % 2 ? '#FFC46B' : accent} transparent opacity={0.72} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      <pointLight ref={light} position={[0, 0.4, 0.4]} color={accent} distance={6} decay={2} />
      <mesh rotation-x={Math.PI / 2}>
        <ringGeometry args={[1.02, 1.06, 72]} />
        <meshBasicMaterial color="#FFE3B0" transparent opacity={0.4} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </Rig>
  );
}

/** Atlas — a spice globe with two orbital bands and moons (regions & swaps). */
export function AtlasMesh({ accent }) {
  const globe = useRef();
  const wire = useRef();
  const orbit = useRef();
  useFrame((state, delta) => {
    if (globe.current) globe.current.rotation.y += delta * 0.34;
    if (wire.current) wire.current.rotation.y -= delta * 0.18;
    if (orbit.current) orbit.current.rotation.z += delta * 0.5;
  });
  return (
    <Rig speed={0.2} float={1.3}>
      <mesh ref={globe}>
        <sphereGeometry args={[0.66, 48, 48]} />
        <meshStandardMaterial color="#14202A" metalness={0.35} roughness={0.55} emissive="#08131c" />
      </mesh>
      <mesh ref={wire}>
        <sphereGeometry args={[0.68, 22, 16]} />
        <meshBasicMaterial color={accent} wireframe transparent opacity={0.5} />
      </mesh>
      <group ref={orbit} rotation={[Math.PI / 2.6, 0, 0]}>
        <mesh>
          <torusGeometry args={[1.12, 0.014, 8, 96]} />
          <meshBasicMaterial color={accent} transparent opacity={0.8} toneMapped={false} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.cos((i / 3) * Math.PI * 2) * 1.12, 0, Math.sin((i / 3) * Math.PI * 2) * 1.12]}>
            <sphereGeometry args={[0.075 + i * 0.02, 20, 20]} />
            <meshStandardMaterial color={['#E24B4B', '#FFD28A', '#7ED9A6'][i]} roughness={0.4} metalness={0.2} />
          </mesh>
        ))}
      </group>
      <mesh rotation={[Math.PI / 1.7, 0.4, 0]}>
        <torusGeometry args={[1.42, 0.008, 8, 96]} />
        <meshBasicMaterial color="#FFF8F1" transparent opacity={0.28} />
      </mesh>
    </Rig>
  );
}

/** Miso — a jar of rising fermentation bubbles behind glass. */
export function MisoMesh({ accent }) {
  const bubbles = useRef();
  const seeds = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        angle: (i / 16) * Math.PI * 2,
        radius: 0.16 + Math.random() * 0.34,
        speed: 0.3 + Math.random() * 0.5,
        phase: Math.random(),
        size: 0.03 + Math.random() * 0.05,
      })),
    []
  );
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!bubbles.current) return;
    bubbles.current.children.forEach((child, i) => {
      const seed = seeds[i];
      const life = (t * seed.speed + seed.phase * 3) % 1;
      child.position.set(Math.cos(seed.angle + life * 2) * seed.radius, -0.5 + life * 1.15, Math.sin(seed.angle + life * 2) * seed.radius);
      child.scale.setScalar(0.5 + life * 1.1);
      child.material.opacity = 0.75 * Math.sin(life * Math.PI);
    });
  });
  return (
    <Rig speed={0.24} float={1.1}>
      <mesh>
        <cylinderGeometry args={[0.66, 0.6, 1.32, 40, 1, true]} />
        <meshPhysicalMaterial color="#DCEEF2" transparent opacity={0.16} roughness={0.08} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.16, 0]}>
        <cylinderGeometry args={[0.6, 0.56, 0.98, 40]} />
        <meshStandardMaterial color="#7A5A2E" roughness={0.72} metalness={0.05} emissive="#3a2708" emissiveIntensity={0.5} />
      </mesh>
      <group ref={bubbles}>
        {seeds.map((seed, i) => (
          <mesh key={i}>
            <sphereGeometry args={[seed.size * 6, 16, 16]} />
            <meshStandardMaterial color={accent} transparent opacity={0.6} roughness={0.12} metalness={0} emissive={accent} emissiveIntensity={0.5} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[0.7, 0.68, 0.12, 40]} />
        <meshStandardMaterial color={accent} metalness={0.85} roughness={0.25} />
      </mesh>
      <pointLight position={[0, -0.1, 0.6]} color={accent} intensity={4} distance={4.5} />
    </Rig>
  );
}

export const COPILOT_MESHES = {
  sigma: SigmaMesh,
  manus: ManusMesh,
  nova: NovaMesh,
  atlas: AtlasMesh,
  miso: MisoMesh,
};

export function CopilotMesh({ mesh = 'sigma', accent = '#FF8A3D' }) {
  const Component = COPILOT_MESHES[mesh] ?? NovaMesh;
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[2.6, 3.4, 2.4]} intensity={1.5} color="#FFF3E4" />
      <directionalLight position={[-3, -1.5, -2]} intensity={0.6} color={accent} />
      <Component accent={accent} />
    </>
  );
}
