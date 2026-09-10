import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Float, Lightformer, MeshDistortMaterial, RoundedBox, Sparkles } from '@react-three/drei';

/**
 * Hero scene: a procedural pot on a board with rising steam, orbiting
 * ingredients and a knife. No GLTF/HDRI downloads — everything is built from
 * primitives so the scene loads instantly and works offline.
 */

export function HeroLights() {
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 5]} intensity={1.35} color="#FFF1E0" />
      <pointLight position={[-3.4, 1.4, 2.6]} intensity={22} color="#7CC5F7" distance={12} />
      <pointLight position={[0, -0.6, 1.6]} intensity={16} color="#FF8A3D" distance={9} />
      {/* Procedural reflections for the metal parts, rendered once. */}
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={2.6} color="#FF8A3D" position={[3, 3, 4]} scale={[7, 7, 1]} />
        <Lightformer intensity={1.5} color="#7CC5F7" position={[-4, 1.5, -3]} scale={[7, 4, 1]} />
        <Lightformer intensity={0.9} color="#FFF8F1" position={[0, -3, 2]} rotation-x={Math.PI / 2} scale={[9, 3, 1]} />
      </Environment>
    </>
  );
}

function Pot() {
  const sauce = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (sauce.current) {
      sauce.current.rotation.z = t * 0.35;
      sauce.current.position.y = 0.72 + Math.sin(t * 1.6) * 0.012;
    }
  });
  return (
    <group>
      <mesh castShadow position={[0, 0.35, 0]}>
        <cylinderGeometry args={[1.06, 0.9, 0.78, 64, 1, true]} />
        <meshStandardMaterial color="#2A2422" metalness={0.85} roughness={0.28} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.98, 0.84, 0.7, 64, 1, true]} />
        <meshStandardMaterial color="#120F0E" metalness={0.4} roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      {/* rim */}
      <mesh position={[0, 0.74, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[1.05, 0.045, 20, 80]} />
        <meshStandardMaterial color="#FF8A3D" metalness={0.9} roughness={0.22} emissive="#4d1f06" />
      </mesh>
      {/* handles */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 1.22, 0.55, 0]} rotation-z={Math.PI / 2}>
          <torusGeometry args={[0.17, 0.035, 12, 32, Math.PI]} />
          <meshStandardMaterial color="#C9B8AC" metalness={0.95} roughness={0.25} />
        </mesh>
      ))}
      {/* simmering surface */}
      <mesh ref={sauce} position={[0, 0.72, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.99, 48]} />
        <MeshDistortMaterial
          color="#E8873A"
          emissive="#7a2f06"
          emissiveIntensity={0.55}
          roughness={0.42}
          metalness={0.1}
          speed={2.4}
          distort={0.22}
        />
      </mesh>
      <mesh position={[0, -0.06, 0]}>
        <cylinderGeometry args={[0.94, 0.94, 0.1, 48]} />
        <meshStandardMaterial color="#0C0A09" metalness={0.5} roughness={0.6} />
      </mesh>
    </group>
  );
}

function Burner() {
  const flame = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (flame.current) {
      const flicker = 0.82 + Math.sin(t * 11) * 0.08 + Math.sin(t * 27.3) * 0.05;
      flame.current.scale.set(flicker, flicker * (1 + Math.sin(t * 7) * 0.06), flicker);
      flame.current.children.forEach((child, i) => {
        child.rotation.y = t * (0.6 + i * 0.18);
      });
    }
  });
  return (
    <group ref={flame} position={[0, -0.34, 0]}>
      {Array.from({ length: 7 }).map((_, i) => {
        const angle = (i / 7) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(angle) * 0.52, 0, Math.sin(angle) * 0.52]}>
            <coneGeometry args={[0.13, 0.42, 10, 1, true]} />
            <meshBasicMaterial color={i % 2 ? '#FFB347' : '#FF6A2B'} transparent opacity={0.72} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
      <pointLight position={[0, -0.1, 0]} intensity={9} color="#FF7A2F" distance={4.2} decay={2} />
    </group>
  );
}

/** Steam: one InstancedMesh, matrices written per frame — cheap and it reads as volumetric. */
function Steam({ count = 26 }) {
  const mesh = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        angle: Math.random() * Math.PI * 2,
        radius: 0.18 + Math.random() * 0.62,
        speed: 0.22 + Math.random() * 0.3,
        phase: (i / count) * 3.4 + Math.random() * 0.6,
        wobble: 0.22 + Math.random() * 0.5,
        scale: 0.1 + Math.random() * 0.16,
      })),
    [count]
  );

  useFrame((state) => {
    if (!mesh.current) return;
    const t = state.clock.elapsedTime;
    seeds.forEach((seed, i) => {
      const life = (t * seed.speed + seed.phase) % 1;
      const y = 0.82 + life * 1.9;
      const spread = 0.35 + life * 1.15;
      dummy.position.set(
        Math.cos(seed.angle + life * 1.5) * seed.radius + Math.sin(t * seed.wobble + i) * 0.1 * spread,
        y,
        Math.sin(seed.angle + life * 1.5) * seed.radius
      );
      const fade = Math.sin(life * Math.PI);
      const s = seed.scale * (0.55 + life * 1.9) * (0.35 + fade);
      dummy.scale.setScalar(Math.max(0.001, s));
      dummy.rotation.set(life * 2.1, life * 1.4, 0);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial color="#FFF3E4" transparent opacity={0.14} depthWrite={false} />
    </instancedMesh>
  );
}

function Ingredients() {
  const group = useRef();
  const items = useMemo(
    () => [
      { geo: 'sphere', size: 0.2, color: '#E24B4B', label: 'tomato', tilt: 0.32, radius: 2.05, speed: 0.42, y: 1.05 },
      { geo: 'torus', size: 0.17, color: '#7ED9A6', label: 'herb', tilt: -0.4, radius: 2.4, speed: -0.31, y: 0.5 },
      { geo: 'box', size: 0.2, color: '#F3E2C0', label: 'butter', tilt: 0.6, radius: 2.15, speed: 0.5, y: -0.1 },
      { geo: 'octa', size: 0.19, color: '#C9A2FF', label: 'onion', tilt: 0.15, radius: 2.6, speed: -0.24, y: 1.5 },
      { geo: 'cone', size: 0.18, color: '#FFD28A', label: 'chilli', tilt: -0.55, radius: 2.25, speed: 0.36, y: -0.55 },
    ],
    []
  );

  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    group.current.children.forEach((child, i) => {
      const item = items[i];
      if (!item) return;
      const a = t * item.speed + i * 1.7;
      child.position.set(Math.cos(a) * item.radius, item.y + Math.sin(t * 0.9 + i) * 0.12, Math.sin(a) * item.radius * 0.55);
      child.rotation.x += 0.006 + i * 0.001;
      child.rotation.y += 0.009;
    });
  });

  return (
    <group ref={group}>
      {items.map((item) => (
        <mesh key={item.label}>
          {item.geo === 'sphere' && <sphereGeometry args={[item.size, 32, 32]} />}
          {item.geo === 'torus' && <torusGeometry args={[item.size, item.size * 0.42, 16, 48]} />}
          {item.geo === 'box' && <boxGeometry args={[item.size * 1.5, item.size * 0.7, item.size]} />}
          {item.geo === 'octa' && <octahedronGeometry args={[item.size, 0]} />}
          {item.geo === 'cone' && <coneGeometry args={[item.size * 0.7, item.size * 2, 14]} />}
          <meshStandardMaterial color={item.color} metalness={0.25} roughness={0.42} emissive={item.color} emissiveIntensity={0.12} />
        </mesh>
      ))}
    </group>
  );
}

function Knife() {
  return (
    <Float speed={1.5} rotationIntensity={0.35} floatIntensity={0.6}>
      <group position={[2.35, -0.62, 0.5]} rotation={[0.1, -0.65, 0.24]}>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[1.5, 0.02, 0.32]} />
          <meshStandardMaterial color="#DCE3EA" metalness={1} roughness={0.12} />
        </mesh>
        <mesh position={[0, 0.012, 0]} scale={[1, 1, 0.72]}>
          <boxGeometry args={[1.5, 0.012, 0.32]} />
          <meshStandardMaterial color="#FFFFFF" metalness={1} roughness={0.04} />
        </mesh>
        <mesh position={[-1.0, 0, 0]}>
          <boxGeometry args={[0.55, 0.09, 0.24]} />
          <meshStandardMaterial color="#3A2A20" metalness={0.15} roughness={0.62} />
        </mesh>
        <mesh position={[-0.7, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.26, 12]} />
          <meshStandardMaterial color="#FF8A3D" metalness={0.9} roughness={0.24} />
        </mesh>
      </group>
    </Float>
  );
}

function Board() {
  return (
    <group position={[0, -0.62, 0]}>
      <RoundedBox args={[5.4, 0.16, 3.2]} radius={0.07} smoothness={4} receiveShadow>
        <meshStandardMaterial color="#241C17" roughness={0.82} metalness={0.05} />
      </RoundedBox>
      <RoundedBox args={[4.6, 0.05, 2.5]} radius={0.03} smoothness={3} position={[0, 0.1, 0]}>
        <meshStandardMaterial color="#3A2B21" roughness={0.7} metalness={0.03} />
      </RoundedBox>
    </group>
  );
}

/** Pointer parallax: the whole rig leans toward the cursor. */
function ParallaxRig({ children }) {
  const group = useRef();
  useFrame((state, delta) => {
    if (!group.current) return;
    const targetX = state.pointer.y * 0.16;
    const targetY = state.pointer.x * 0.32;
    group.current.rotation.x += (targetX - group.current.rotation.x) * Math.min(1, delta * 3.4);
    group.current.rotation.y += (targetY - group.current.rotation.y) * Math.min(1, delta * 3.4);
    group.current.position.x += (state.pointer.x * 0.16 - group.current.position.x) * Math.min(1, delta * 2.6);
  });
  return <group ref={group}>{children}</group>;
}

export function KitchenHeroScene() {
  return (
    <>
      <HeroLights />
      <ParallaxRig>
        <group position={[0, 0.1, 0]} rotation={[0, 0, 0]}>
          <Float speed={1.25} rotationIntensity={0.16} floatIntensity={0.45}>
            <Pot />
            <Burner />
            <Steam />
          </Float>
          <Ingredients />
          <Knife />
          <Board />
        </group>
      </ParallaxRig>
      <Sparkles count={34} scale={[7, 3.6, 4]} position={[0, 1.1, 0.4]} size={2.1} speed={0.32} color="#FFD28A" opacity={0.5} />
      <ContactShadows position={[0, -0.74, 0]} opacity={0.55} scale={9} blur={2.6} far={3.2} resolution={512} color="#000000" />
    </>
  );
}
