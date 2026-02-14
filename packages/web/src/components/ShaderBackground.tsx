"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import * as THREE from "three";

import { cn } from "@/lib/utils";
import { NoiseTexture } from "./NoiseTexture";

// Check for WebGL support
function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

interface ShaderPlaneProps {
  vertexShader: string;
  fragmentShader: string;
  uniforms: { [key: string]: { value: unknown } };
  onReady?: () => void;
}

const ShaderPlane = ({
  vertexShader,
  fragmentShader,
  uniforms,
  onReady,
}: ShaderPlaneProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { size } = useThree();
  const hasCalledReady = useRef(false);

  useFrame((state) => {
    if (meshRef.current) {
      const material = meshRef.current.material as THREE.ShaderMaterial;
      material.uniforms.u_time.value = state.clock.elapsedTime * 0.5;
      material.uniforms.u_resolution.value.set(size.width, size.height, 1.0);
      
      // Signal ready after first successful frame
      if (!hasCalledReady.current && onReady) {
        hasCalledReady.current = true;
        onReady();
      }
    }
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.FrontSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
};

interface ShaderBackgroundProps {
  className?: string;
  color?: string;
  backgroundColor?: string;
}

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  varying vec2 vUv;
  uniform float u_time;
  uniform vec3 u_resolution;
  uniform vec3 u_color;
  uniform vec3 u_bg_color;

  float bayerDither(vec2 fragCoord) {
    float scale = 4.0;
    int x = int(mod(floor(fragCoord.x / scale), 4.0));
    int y = int(mod(floor(fragCoord.y / scale), 4.0));
    int idx = x + y * 4;
    float bayer[16];
    bayer[0] = 0.0;  bayer[1] = 8.0;  bayer[2] = 2.0;  bayer[3] = 10.0;
    bayer[4] = 12.0; bayer[5] = 4.0;  bayer[6] = 14.0; bayer[7] = 6.0;
    bayer[8] = 3.0;  bayer[9] = 11.0; bayer[10] = 1.0; bayer[11] = 9.0;
    bayer[12] = 15.0; bayer[13] = 7.0; bayer[14] = 13.0; bayer[15] = 5.0;
    return bayer[idx] / 16.0;
  }

  void mainImage(out vec4 col, in vec2 pc) {
    float time = u_time / 3.0;
    vec2 a = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 c = pc.xy / u_resolution.xy * a * 3.5 + time * 0.3;

    float k = 0.1 + cos(c.y + sin(0.148 - time)) + 2.4 * time;
    float w = 0.9 + sin(c.x + cos(0.628 + time)) - 0.7 * time;
    float d = length(c);
    float s = 7.0 * cos(d + w) * sin(k + w);

    col = vec4(0.5 + 0.5 * cos(s + vec3(0.2, 0.5, 0.9)), 1.0);
  }

  void main() {
    vec2 fragCoord = vUv * u_resolution.xy;
    vec4 col;
    mainImage(col, fragCoord);

    float gray = dot(col.rgb, vec3(0.299, 0.587, 0.114));
    float threshold = bayerDither(fragCoord);
    float bw = step(threshold, gray);
    col.rgb = mix(u_bg_color, u_color, bw);

    gl_FragColor = col;
  }
`;

export function ShaderBackground({
  className,
  color = "#b855f7",
  backgroundColor = "#0a0a0f",
}: ShaderBackgroundProps): React.JSX.Element {
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasWebGL, setHasWebGL] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Check WebGL support on mount
    const webglSupported = isWebGLAvailable();
    setHasWebGL(webglSupported);
    setMounted(true);
  }, []);

  const handleReady = useCallback(() => {
    setReady(true);
  }, []);

  const handleError = useCallback(() => {
    console.error("ShaderBackground: Canvas creation failed");
    setError(true);
  }, []);

  const shaderUniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector3(1, 1, 1) },
      u_color: { value: new THREE.Color(color) },
      u_bg_color: { value: new THREE.Color(backgroundColor) },
    }),
    [color, backgroundColor],
  );

  // Fallback to 2D canvas if not mounted, no WebGL, or error
  if (!mounted || !hasWebGL || error) {
    return (
      <div className={cn("absolute inset-0 w-full h-full", className)}>
        <NoiseTexture staticOpacity />
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "absolute inset-0 w-full h-full transition-opacity duration-1000",
        ready ? "opacity-100" : "opacity-0",
        className
      )}
    >
      <Canvas
        gl={{ 
          antialias: false, 
          alpha: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true,
          failIfMajorPerformanceCaveat: false,
        }}
        dpr={[1, 1.5]}
        frameloop="always"
        onCreated={() => {
          // Canvas created successfully
        }}
        onError={handleError}
      >
        <ShaderPlane
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={shaderUniforms}
          onReady={handleReady}
        />
      </Canvas>
    </div>
  );
}
