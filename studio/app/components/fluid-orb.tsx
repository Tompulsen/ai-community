"use client";

import React, { useEffect, useRef } from "react";
import { useAppConfig } from "../store/config";

type FluidOrbProps = React.ComponentProps<"div"> & {
  size?: number;
  levelRef?: React.RefObject<number>;
};

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_level;
uniform vec3 u_color;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.65;
  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );
  vec2 p = vec2(uv.x * 1.8, uv.y) + drift * 0.7;
  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + 1.2 * q);
  float g = clamp(1.0 - uv.y, 0.0, 1.0);
  float anchor = smoothstep(0.0, 0.3, uv.y);
  float amplitude = 0.025 + u_level * 0.15;
  float wave = amplitude * sin(uv.x * 7.0 + t * 2.0 + q.x * 2.0)
    + amplitude * 0.45 * sin(uv.x * 11.0 - t * 1.4);
  float shade = clamp(g + wave + (f - 0.5) * (0.55 + u_level * 1.2) * anchor, 0.0, 1.0);
  vec3 white = vec3(0.99, 1.0, 1.0);
  vec3 light = mix(white, u_color, 0.5);
  vec3 col = mix(white, light, smoothstep(0.28, 0.52, shade));
  col = mix(col, u_color, smoothstep(0.58, 0.88, shade));
  float edge = 1.0 - smoothstep(0.49, 0.5, distance(uv, vec2(0.5)));
  gl_FragColor = vec4(col * edge, edge);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function FluidOrb({
  size = 32,
  levelRef,
  style,
  ...props
}: FluidOrbProps) {
  const reduceMotion = useAppConfig((config) => config.reduceMotion);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { antialias: true, alpha: true });
    if (!canvas || !gl) return;

    const program = gl.createProgram();
    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const buffer = gl.createBuffer();
    const dispose = () => {
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteBuffer(buffer);
    };
    if (!program || !vert || !frag || !buffer) {
      dispose();
      return;
    }
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      dispose();
      return;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "u_resolution");
    const time = gl.getUniformLocation(program, "u_time");
    const level = gl.getUniformLocation(program, "u_level");
    const color = gl.getUniformLocation(program, "u_color");

    const updateSize = () => {
      const px = Math.max(
        1,
        Math.round(
          (canvas.clientWidth || size) *
            Math.min(window.devicePixelRatio || 1, 2),
        ),
      );
      canvas.width = px;
      canvas.height = px;
      gl.viewport(0, 0, px, px);
      gl.uniform2f(resolution, px, px);
    };
    const updateColor = () => {
      const hex = getComputedStyle(canvas).getPropertyValue("--primary").trim();
      const full =
        hex.length === 4
          ? "#" +
            hex
              .slice(1)
              .split("")
              .map((c) => c + c)
              .join("")
          : hex;
      const value = parseInt(full.slice(1), 16);
      gl.uniform3f(
        color,
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255,
      );
    };
    updateSize();
    updateColor();
    const observer = new MutationObserver(updateColor);
    for (const target of [document.body, document.documentElement]) {
      observer.observe(target, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", updateColor);
    window.addEventListener("resize", updateSize);

    let elapsed = 0;
    let previous = performance.now();
    let raf = 0;
    const render = (now: number) => {
      const volume = Math.min(1, Math.max(0, levelRef?.current ?? 0));
      // Keep the recording indicator alive with gentler flow for reduced motion.
      elapsed +=
        Math.min((now - previous) / 1000, 0.1) *
        (reduceMotion ? 0.6 : 1) *
        (0.75 + volume * 2.25);
      previous = now;
      gl.uniform1f(time, elapsed);
      gl.uniform1f(level, volume);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };
    render(previous);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      dark.removeEventListener("change", updateColor);
      window.removeEventListener("resize", updateSize);
      dispose();
    };
  }, [size, levelRef, reduceMotion]);

  return (
    <div
      data-slot="fluid-orb"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        boxSizing: "border-box",
        borderRadius: "50%",
        overflow: "hidden",
        background: "linear-gradient(180deg, var(--white), var(--primary))",
        ...style,
      }}
      {...props}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
